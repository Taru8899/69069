// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface ISOS69069 {
    function effectiveOf(address user) external view returns (int256);
    function recordStructHash(
        address signer,
        address intendedTo,
        bytes32 payloadHash,
        string calldata metadata
    ) external pure returns (bytes32);
    function recordSignature(
        address signer,
        address intendedTo,
        bytes32 payloadHash,
        bytes calldata signature,
        string calldata metadata
    ) external;
    function isRecordHashUsed(bytes32 structHash) external view returns (bool);
}

/**
 * @title SOS69069cSOS
 * @notice Read-only wrapper over SOS69069. Mints a transferable ERC-20
 *         against a user's current effective metric.
 *
 *         HARD CAP RULE (immutable):
 *
 *             maximum cumulative cSOS minted
 *             = max(0, effectiveOf(user) - 10)
 *
 *         RESERVE is permanently set to 10.
 *
 *         Examples:
 *             effective = 39  → maximum minted = 29
 *             effective = 100 → maximum minted = 90
 *             effective = 10  → maximum minted = 0
 *             effective < 10  → maximum minted = 0
 *
 * =====================================================================
 * NO AUDITOR. THE USER IS THEIR OWN AUDITOR.
 * =====================================================================
 * Every mint requires a user-signed EIP-712 Record:
 *
 *     Record(
 *         signer      = user,
 *         intendedTo  = user,
 *         payloadHash = unique-per-mint bytes32,
 *         metadata    = "cSOS:MINT:<decimal amount>"
 *     )
 *
 * The wrapper submits that record to SOS69069 on EVERY mint.
 * The ledger permanently stores it, ECDSA-verified.
 * There is no trusted key, no privileged submitter, no auditor role.
 *
 * =====================================================================
 * FEE AND DONATION HANDLING
 * =====================================================================
 * Recommended deployment: MINT_FEE = 0 (pure gas-only model).
 *
 * Any ETH attached to mint() / mintMax() above (amount * MINT_FEE)
 * is treated as a voluntary donation to:
 *
 *     SOS69069_CREATOR = 0x1C10e6574ee696f54b21A611a21313E4714628ad
 *
 * Donations and fees accumulate and are released only via the
 * permissionless pull functions sweepDonations() / sweepFees().
 * Minting can never be blocked by the creator or treasury.
 *
 * =====================================================================
 * DEX / LP COMPATIBILITY
 * =====================================================================
 * Fully ERC-20 compatible. Any user can create a liquidity pool on
 * Uniswap V2/V3, Sushi, Pancake, etc. with no code changes.
 * Standard surface used by AMM routers is present:
 * balanceOf, approve, transfer, transferFrom, allowance,
 * totalSupply, name, symbol, decimals.
 *
 * receive()/fallback() reverts do not affect LP creation
 * (ETH goes to the pair contract, not to cSOS).
 *
 * =====================================================================
 * ANTI-EXPLOIT MEASURES
 * =====================================================================
 * - nonReentrant on mint paths + sweeps
 * - receive/fallback revert
 * - pull-payment only (fees & donations)
 * - local usedMintHash + ledger authoritative replay protection
 * - post-condition check that ledger consumed the hash
 * - strict CEI ordering
 * - no admin, no pause, no upgrade, no selfdestruct, no proxy
 */
contract SOS69069cSOS {

    ISOS69069 public constant LEDGER =
        ISOS69069(0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A);

    // ---------------- Constants ----------------

    /// @notice Permanent 10-SOS reserve.
    ///         max cumulative mint = max(0, effectiveOf(user) - 10)
    uint256 public constant RESERVE = 10;

    uint256 public immutable MINT_FEE;
    uint256 public constant RECORD_GAS_ESTIMATE = 80_000;
    string  public constant MINT_METADATA_PREFIX = "cSOS:MINT:";

    address public constant SOS69069_CREATOR =
        0x1C10e6574ee696f54b21A611a21313E4714628ad;

    address public immutable TREASURY;

    // ---------------- State ----------------

    uint256 public pendingTreasuryFees;
    uint256 public pendingDonations;
    uint256 public totalDonationsReceived;
    uint256 public totalFeesReceived;

    string  public constant name     = "Capped SOS";
    string  public constant symbol   = "cSOS";
    uint8   public constant decimals = 0;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public minted;
    mapping(address => uint256) public costBasis;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(bytes32 => bool) public usedMintHash;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status;

    // ---------------- Events ----------------

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    event Minted(
        address indexed user,
        uint256 amount,
        uint256 ethPaid,
        uint256 lifetimeMinted
    );

    event MintRecorded(
        address indexed user,
        uint256 amount,
        bytes32 indexed structHash,
        string metadata
    );

    event FeesSwept(address indexed caller, uint256 amount);
    event DonationReceived(address indexed user, uint256 amount);
    event DonationsSwept(address indexed caller, uint256 amount);

    // ---------------- Errors ----------------

    error ZeroAddress();
    error ExceedsMintable();
    error InsufficientBalance();
    error InsufficientAllowance();
    error WrongFee();
    error DuplicateMint();
    error Reentrancy();
    error LedgerHashNotConsumed();
    error EthNotAccepted();
    error TreasuryTransferFailed();
    error DonationTransferFailed();

    constructor(uint256 _mintFee, address _treasury) {
        if (_treasury == address(0)) revert ZeroAddress();
        MINT_FEE = _mintFee;
        TREASURY = _treasury;
        _status  = _NOT_ENTERED;
    }

    // =================================================================
    // Reject plain ETH
    // =================================================================

    receive() external payable { revert EthNotAccepted(); }
    fallback() external payable { revert EthNotAccepted(); }

    // =================================================================
    // Views
    // =================================================================

    /**
     * @notice Remaining mintable amount.
     *         mintable = max(0, effectiveOf(user) - 10 - minted[user])
     */
    function mintable(address user) public view returns (uint256) {
        int256 eff = LEDGER.effectiveOf(user);
        if (eff <= int256(RESERVE)) return 0;
        uint256 cap = uint256(eff) - RESERVE;
        uint256 m = minted[user];
        if (m >= cap) return 0;
        return cap - m;
    }

    function gasFloor() public view returns (uint256) {
        return RECORD_GAS_ESTIMATE * tx.gasprice;
    }

    function mintMetadata(uint256 amount) public pure returns (string memory) {
        return string(abi.encodePacked(MINT_METADATA_PREFIX, _toString(amount)));
    }

    function mintStructHash(
        address user,
        uint256 amount,
        bytes32 payloadHash
    ) public pure returns (bytes32) {
        return LEDGER.recordStructHash(
            user,
            user,
            payloadHash,
            mintMetadata(amount)
        );
    }

    function mintPreview(
        address user,
        uint256 amount,
        bytes32 payloadHash
    ) external pure returns (string memory metadata, bytes32 structHash) {
        metadata   = mintMetadata(amount);
        structHash = LEDGER.recordStructHash(user, user, payloadHash, metadata);
    }

    // =================================================================
    // Write paths
    // =================================================================

    function mint(
        uint256 amount,
        bytes32 payloadHash,
        bytes calldata signature
    ) external payable nonReentrant {
        if (amount == 0) revert ExceedsMintable();
        _executeMint(amount, payloadHash, signature);
    }

    function mintMax(
        bytes32 payloadHash,
        bytes calldata signature
    ) external payable nonReentrant returns (uint256 amount) {
        amount = mintable(msg.sender);
        if (amount == 0) revert ExceedsMintable();
        _executeMint(amount, payloadHash, signature);
    }

    function sweepFees() external nonReentrant {
        uint256 amt = pendingTreasuryFees;
        if (amt == 0) return;

        pendingTreasuryFees = 0;

        (bool ok, ) = TREASURY.call{value: amt}("");
        if (!ok) revert TreasuryTransferFailed();

        emit FeesSwept(msg.sender, amt);
    }

    function sweepDonations() external nonReentrant {
        uint256 amt = pendingDonations;
        if (amt == 0) return;

        pendingDonations = 0;

        (bool ok, ) = SOS69069_CREATOR.call{value: amt}("");
        if (!ok) revert DonationTransferFailed();

        emit DonationsSwept(msg.sender, amt);
    }

    // =================================================================
    // Internal mint logic
    // =================================================================

    function _executeMint(
        uint256 amount,
        bytes32 payloadHash,
        bytes calldata signature
    ) internal {
        // Checks
        uint256 available = mintable(msg.sender);
        if (amount > available) revert ExceedsMintable();

        uint256 cost = amount * MINT_FEE;
        if (msg.value < cost) revert WrongFee();

        uint256 donation = msg.value - cost;

        string memory metadata = mintMetadata(amount);
        bytes32 sh = LEDGER.recordStructHash(
            msg.sender, msg.sender, payloadHash, metadata
        );
        if (usedMintHash[sh]) revert DuplicateMint();

        // Effects
        usedMintHash[sh]      = true;
        minted[msg.sender]    += amount;
        costBasis[msg.sender] += cost;
        totalFeesReceived     += cost;
        pendingTreasuryFees   += cost;

        if (donation > 0) {
            pendingDonations       += donation;
            totalDonationsReceived += donation;
        }

        // Interactions
        LEDGER.recordSignature(
            msg.sender, msg.sender, payloadHash, signature, metadata
        );

        if (!LEDGER.isRecordHashUsed(sh)) revert LedgerHashNotConsumed();

        _mint(msg.sender, amount);

        // Events
        emit Minted(msg.sender, amount, cost, minted[msg.sender]);
        emit MintRecorded(msg.sender, amount, sh, metadata);

        if (donation > 0) {
            emit DonationReceived(msg.sender, donation);
        }
    }

    // =================================================================
    // ERC-20 surface
    // =================================================================

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        uint256 newAllowance = allowance[msg.sender][spender] + addedValue;
        allowance[msg.sender][spender] = newAllowance;
        emit Approval(msg.sender, spender, newAllowance);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 current = allowance[msg.sender][spender];
        if (current < subtractedValue) revert InsufficientAllowance();
        uint256 newAllowance = current - subtractedValue;
        allowance[msg.sender][spender] = newAllowance;
        emit Approval(msg.sender, spender, newAllowance);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external returns (bool)
    {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert InsufficientAllowance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;

        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // =================================================================
    // Reentrancy guard
    // =================================================================

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrancy();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // =================================================================
    // Helpers
    // =================================================================

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}