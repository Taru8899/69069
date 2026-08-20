// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

/**
 * @title 69069
 * @notice Pure on-chain ledger that records signatures as immutable events.
 *         Never executes, delegates, or acts on any recorded signature.
 *
 * =====================================================================
 * BRAND
 * =====================================================================
 *
 * 69069 is a Ledger of Presence with no Assets to hold and no
 * Wallet to drain.
 *
 * Presence written Permanently into the block History, carried Forward
 * by activity, and made Provable through its x2 Legacy Continuity System.
 * An Identityless Record Field.
 *
 * =====================================================================
 * HOW THIS CONTRACT WORKS (PRECISE)
 * =====================================================================
 *
 * 1. PURPOSE
 *    Public, append-only ledger of signatures. Stores nothing that can
 *    be executed later. It only verifies ECDSA signatures, increments
 *    two independent counters per address, and emits events.
 *    No code runs on behalf of the signer. No funds move. No approvals.
 *
 * 2. WHAT THE SIGNATURE ACTUALLY PROVES
 *    Every record function requires a valid signature. The signer signs
 *    an EIP-712 typed struct that binds together, inseparably:
 *        signer, intendedTo, payloadHash, keccak256(metadata),
 *        this contract's address, and the chain id.
 *
 *    A valid signature on this ledger therefore:
 *      - cannot be replayed from another contract or another chain,
 *      - cannot be resubmitted with a different intendedTo,
 *      - cannot be resubmitted with different metadata,
 *      - cannot be a signature produced for an unrelated purpose and
 *        repurposed here.
 *
 *    There is no unverified / unchecked record path in this contract.
 *    Every record function performs full ECDSA verification.
 *
 * 3. ZERO-COST PARTICIPATION
 *    - A user signs the typed struct off-chain (wallet signature only).
 *    - Anyone may later submit that signature on-chain and pay the gas
 *      ("submitter"). The signer never has to send a transaction.
 *    - The signer may also be the submitter if they choose to.
 *
 * 4. ONE RECORD = ONE PACKED UNIT
 *    Every successful record creates exactly one atomic record:
 *      signer, intendedTo, payloadHash, signature, metadata (<=64 chars).
 *    There is no path that records a signature without an intendedTo.
 *
 * 5. COUNTERS
 *    Push[user]   += 1 every time user appears as signer
 *    Trust[user]  += 1 every time user appears as intendedTo
 *    phaseTotal   += 1 every time any record is written
 *    Cyclic; wraps to 0 at type(uint256).max and increments a permanent,
 *    non-wrapping overflow counter.
 *
 * 6. EFFECTIVE DIFFERENCE (NOT STORED — ALWAYS COMPUTED ON READ)
 *    effectiveOf(user) = Trust[user] - Push[user], derived live.
 *    balanceOf(user) = max(0, effectiveOf(user)), also derived live.
 *
 * 7. EVENTS
 *    SignatureRecorded – emitted once per verified record, always.
 *    Transfer          – emitted once PER individual signature, with
 *                         value = 1, even inside a batch, so ERC-20
 *                         wallets/explorers render one +1 row per
 *                         signature, not one lumped row per batch.
 *    PushOverflow / TrustOverflow / PhaseOverflow – counter wraps.
 *
 * 8. WRITE FUNCTIONS (ONLY TWO EXIST)
 *    recordSignature    – records ONE verified signature.
 *    recordSignatureOne – records MANY verified signatures from ONE
 *                          signer to ONE intended address in a single
 *                          transaction ("batch sign"), capped at
 *                          MAX_BATCH_SIZE items per call.
 *
 *    Both require full EIP-712 signature verification. There is no
 *    unchecked / unverified write path.
 *
 * 9. BATCH GAS OPTIMIZATION (WITHOUT LOSING PER-ITEM Transfer)
 *    recordSignatureOne verifies and logs every item individually — its
 *    own EIP-712 verification, its own dedup check, its own
 *    SignatureRecorded event, its own Transfer(+1) event. No data is
 *    dropped, merged, or summarized.
 *
 *    What IS aggregated: the Push[signer], Trust[intendedTo] and
 *    phaseTotal STORAGE counters are written ONCE per batch (summed
 *    over all N items) instead of N times. Combined with paying the
 *    transaction base fee once instead of N times, recordSignatureOne
 *    remains cheaper per record than N separate recordSignature calls.
 *
 * 10. REPLAY / UNIQUENESS PROTECTION — KEYED BY THE FULL SIGNED STRUCT
 *    Uniqueness is keyed by the exact EIP-712 struct hash of
 *    (signer, intendedTo, payloadHash, metadataHash) — i.e. the precise
 *    thing that was actually signed — NOT by payloadHash alone.
 *
 *    This matters: a signer may legitimately produce two different,
 *    independently valid signatures over the same payloadHash — e.g.
 *    one intended for Bob and a separate one intended for Carol, or the
 *    same recipient with different metadata. Because each is a distinct
 *    signed struct, each gets its own dedup slot and neither blocks the
 *    other. Only resubmission of the EXACT SAME signed struct (the
 *    exact same signer + intendedTo + payloadHash + metadata combination)
 *    reverts with DuplicatePayloadHash() — including a repeat within the
 *    same batch. This also removes the possibility of one valid
 *    signature being used to pre-emptively "burn" a dedup slot that a
 *    signer's other, unrelated, differently-addressed signatures would
 *    have needed.
 *
 * 11. METADATA LIMIT
 *    metadata is capped at 64 bytes/characters on every path.
 *
 * 12. SIGNATURE MALLEABILITY
 *    High-half `s` values are rejected (EIP-2), plus explicit v checks.
 *
 * 13. BATCH SIZE LIMIT
 *    recordSignatureOne reverts with BatchTooLarge() if more than
 *    MAX_BATCH_SIZE items are submitted in one call. This makes the
 *    worst-case gas cost of a single call bounded and predictable,
 *    instead of scaling without limit until an opaque out-of-gas
 *    failure is the only way to discover the ceiling.
 *
 * 14. ERC-20 SURFACE (DISPLAY ONLY)
 *    name() = "69069", symbol() = "SOS", decimals = 0.
 *    balanceOf / totalSupply / Transfer exist solely for wallet/explorer
 *    display. No transfer(), approve(), transferFrom(). Tokens cannot
 *    be moved.
 *
 * 15. SAFETY
 *    - No ETH accepted.
 *    - Zero-address checks on every record.
 *    - EIP-712 domain-separated verification on every write path.
 *    - Duplicate signed structs rejected, exact-match only.
 *    - Metadata length capped at 64 characters.
 *    - Batch size capped at MAX_BATCH_SIZE.
 *    - No selfdestruct, no proxy, no ownable, no admin.
 *
 * CONTRACT IDENTITY
 * - Contract identity → S69069
 * - Token name()      → "69069"
 * - Token symbol()    → "SOS"
 * - Compiler          → Solidity ^0.8.36
 */

contract SOS69069 {

    // ==================== CONSTANTS ====================

    uint256 private constant EXACT_INCREMENT = 1;
    uint256 private constant UINT256_MAX = type(uint256).max;
    uint256 private constant MAX_METADATA_LENGTH = 64;

    /// @dev Upper bound on items per recordSignatureOne call. Chosen to
    ///      keep worst-case batch gas well within typical block gas
    ///      limits; adjust if deploying to a chain with materially
    ///      different limits.
    uint256 private constant MAX_BATCH_SIZE = 200;

    /// @dev secp256k1 group order / 2, for signature malleability rejection.
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev Binds signer + intendedTo + payloadHash + metadata together —
    ///      this is what actually gets signed on every write path, and
    ///      its hash (see _verifySignature) doubles as the dedup key.
    bytes32 private constant RECORD_TYPEHASH =
        keccak256("Record(address signer,address intendedTo,bytes32 payloadHash,bytes32 metadataHash)");

    /// @dev Computed once at deploy time from this contract's address and
    ///      the chain id it was deployed on. Immutable — cannot drift.
    bytes32 private immutable DOMAIN_SEPARATOR;

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("69069")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ==================== INTERNAL STATE ====================

    mapping(address => uint256) private pushOf;
    mapping(address => uint256) private trustOf;
    uint256 private phaseTotal;

    /// @dev Replay protection keyed by the FULL EIP-712 struct hash
    ///      (signer + intendedTo + payloadHash + metadataHash), i.e.
    ///      exactly what was signed — not a partial tuple. A single flat
    ///      mapping: signer is already cryptographically embedded in the
    ///      hash, so no separate per-signer nesting is needed (this is
    ///      also cheaper than a nested mapping: one storage-slot
    ///      derivation instead of two).
    mapping(bytes32 => bool) private usedRecordHash;

    mapping(address => uint256) private pushOverflowCount;
    mapping(address => uint256) private trustOverflowCount;
    uint256 private phaseOverflowCount;

    // ==================== EVENTS ====================

    event SignatureRecorded(
        address indexed signer,
        address indexed intendedTo,
        bytes32 payloadHash,
        bytes signature,
        address indexed submitter,
        uint256 timestamp,
        string metadata
    );

    /// @notice ERC-20 compatibility event. Always emitted with value = 1,
    ///         once per individual signature — including inside a batch.
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 value
    );

    event PushOverflow(address indexed signer, uint256 prevCount);
    event TrustOverflow(address indexed intendedTo, uint256 prevCount);
    event PhaseOverflow(uint256 prevTotal);

    // ==================== ERRORS ====================

    error NoETHAccepted();
    error ZeroAddress();
    error InvalidSignature();
    error LengthMismatch();
    error EmptyBatch();
    error BatchTooLarge();
    error MetadataTooLong();
    error DuplicatePayloadHash();

    // =====================================================================
    // READ FUNCTIONS
    // =====================================================================

    function myStats()
        public
        view
        returns (uint256 pushCount, uint256 trustCount, int256 effective)
    {
        return statsOf(msg.sender);
    }

    /**
     * @notice Effective = Trust - Push. NOT stored, computed live.
     * @dev Safe under normal use: reaching int256 overflow would require
     *      a counter beyond 2^255, computationally unreachable.
     */
    function effectiveOf(address user) public view returns (int256) {
        uint256 trust = trustOf[user];
        uint256 push = pushOf[user];
        unchecked {
            return int256(trust) - int256(push);
        }
    }

    function trustCountOf(address user) public view returns (uint256) {
        return trustOf[user];
    }

    function pushCountOf(address user) public view returns (uint256) {
        return pushOf[user];
    }

    function statsOf(address user)
        public
        view
        returns (uint256 pushCount, uint256 trustCount, int256 effective)
    {
        pushCount = pushOf[user];
        trustCount = trustOf[user];
        unchecked {
            effective = int256(trustCount) - int256(pushCount);
        }
    }

    /**
     * @notice Display-only. NOT stored — computed live as
     *         max(0, effectiveOf(account)) on every call.
     */
    function balanceOf(address account) public view returns (uint256) {
        int256 eff = effectiveOf(account);
        return eff > 0 ? uint256(eff) : 0;
    }

    function name() public pure returns (string memory) {
        return "69069";
    }

    function symbol() public pure returns (string memory) {
        return "SOS";
    }

    function brandText() public pure returns (string memory) {
        return
            "69069 is a Ledger of Presence with no Assets to hold and no Wallet to drain. "
            "Presence written Permanently into the block History, carried Forward by activity, "
            "and made Provable through its x2 Legacy Continuity System. An Identityless Record Field.";
    }

    function trustOverflowCountOf(address user) public view returns (uint256) {
        return trustOverflowCount[user];
    }

    function pushOverflowCountOf(address user) public view returns (uint256) {
        return pushOverflowCount[user];
    }

    function totalPhaseOverflowCount() public view returns (uint256) {
        return phaseOverflowCount;
    }

    function myEffective() public view returns (int256) {
        return effectiveOf(msg.sender);
    }

    function myTrustCount() public view returns (uint256) {
        return trustOf[msg.sender];
    }

    function myPushCount() public view returns (uint256) {
        return pushOf[msg.sender];
    }

    function totalRecorded() public view returns (uint256) {
        return phaseTotal;
    }

    function totalSupply() public view returns (uint256) {
        return phaseTotal;
    }

    function uint256Max() public pure returns (uint256) {
        return type(uint256).max;
    }

    // ---- rest of read functions ----

    function decimals() public pure returns (uint8) {
        return 0;
    }

    /// @notice Domain separator so off-chain signers/wallets can build
    ///         the exact EIP-712 payload to sign.
    function domainSeparator() public view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    /// @notice Computes the exact EIP-712 struct hash for a given
    ///         (signer, intendedTo, payloadHash, metadata) combination —
    ///         the same value used internally as the dedup key. Lets
    ///         integrators check isRecordHashUsed() before submitting.
    function recordStructHash(
        address signer,
        address intendedTo,
        bytes32 payloadHash,
        string calldata metadata
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECORD_TYPEHASH,
                signer,
                intendedTo,
                payloadHash,
                keccak256(bytes(metadata))
            )
        );
    }

    /// @notice Whether a given signed struct (by its hash) has already
    ///         been recorded. Compute the hash via recordStructHash().
    function isRecordHashUsed(bytes32 structHash) public view returns (bool) {
        return usedRecordHash[structHash];
    }

    function myPushOverflowCount() public view returns (uint256) {
        return pushOverflowCount[msg.sender];
    }

    function myTrustOverflowCount() public view returns (uint256) {
        return trustOverflowCount[msg.sender];
    }

    // =====================================================================
    // WRITE FUNCTIONS (ONLY TWO)
    // =====================================================================

    /**
     * @notice Record ONE signature with mandatory EIP-712 verification
     *         binding signer + intendedTo + payloadHash + metadata.
     *
     * Emits one SignatureRecorded and one Transfer(signer, intendedTo, 1).
     *
     * Reverts DuplicatePayloadHash if this exact signed struct
     * (signer, intendedTo, payloadHash, metadata) was already recorded.
     * Reverts MetadataTooLong if metadata exceeds 64 characters.
     */
    function recordSignature(
        address signer,
        address intendedTo,
        bytes32 payloadHash,
        bytes calldata signature,
        string calldata metadata
    ) external {

        if (signer == address(0) || intendedTo == address(0)) {
            revert ZeroAddress();
        }

        _checkMetadataLength(metadata);
        bytes32 structHash = _verifySignature(signer, intendedTo, payloadHash, metadata, signature);
        _claimChecked(structHash);

        _incrementCountersBy(signer, intendedTo, EXACT_INCREMENT);
        emit Transfer(signer, intendedTo, EXACT_INCREMENT);

        emit SignatureRecorded(
            signer,
            intendedTo,
            payloadHash,
            signature,
            msg.sender,
            block.timestamp,
            metadata
        );
    }

    /**
     * @notice Records MANY verified signatures from ONE signer to ONE
     *         intended address ("batch sign"), up to MAX_BATCH_SIZE items.
     *         Every item is independently verified against its own
     *         payloadHash/metadata and emits its OWN SignatureRecorded
     *         event AND its own Transfer(+1) event — N distinct
     *         transfers, exactly as if each had been recorded on its own.
     *
     * GAS: the Push/Trust/phaseTotal STORAGE counters are updated ONCE
     * for the whole batch (summed over all N items) instead of N times,
     * and the transaction base fee is paid once instead of N times —
     * that is what makes recordSignatureOne cheaper per record than N
     * separate recordSignature calls, even though every individual
     * signature still gets its own full event pair.
     *
     * Reverts BatchTooLarge if more than MAX_BATCH_SIZE items are given.
     * Reverts DuplicatePayloadHash if any item's exact signed struct
     * (signer, intendedTo, payloadHashes[i], metadatas[i]) was already
     * recorded, including a repeat within the same batch.
     * Reverts MetadataTooLong if any metadata exceeds 64 characters.
     */
    function recordSignatureOne(
        address signer,
        address intendedTo,
        bytes32[] calldata payloadHashes,
        bytes[] calldata signatures,
        string[] calldata metadatas
    ) external {

        if (signer == address(0) || intendedTo == address(0)) {
            revert ZeroAddress();
        }

        uint256 len = payloadHashes.length;
        if (len == 0) {
            revert EmptyBatch();
        }
        if (len > MAX_BATCH_SIZE) {
            revert BatchTooLarge();
        }
        if (signatures.length != len || metadatas.length != len) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < len; ) {
            _checkMetadataLength(metadatas[i]);
            bytes32 structHash = _verifySignature(
                signer,
                intendedTo,
                payloadHashes[i],
                metadatas[i],
                signatures[i]
            );
            _claimChecked(structHash);

            emit Transfer(signer, intendedTo, EXACT_INCREMENT);

            emit SignatureRecorded(
                signer,
                intendedTo,
                payloadHashes[i],
                signatures[i],
                msg.sender,
                block.timestamp,
                metadatas[i]
            );

            unchecked {
                ++i;
            }
        }

        // Only the underlying storage counters are aggregated into a
        // single write for the whole batch — the event trail above is
        // already fully per-item.
        _incrementCountersBy(signer, intendedTo, len);
    }

    // =====================================================================
    // INTERNAL
    // =====================================================================

    function _checkMetadataLength(string calldata metadata) internal pure {
        if (bytes(metadata).length > MAX_METADATA_LENGTH) {
            revert MetadataTooLong();
        }
    }

    /// @dev Replay guard keyed by the exact signed struct hash.
    function _claimChecked(bytes32 structHash) internal {
        if (usedRecordHash[structHash]) {
            revert DuplicatePayloadHash();
        }
        usedRecordHash[structHash] = true;
    }

    /**
     * @dev Increments Push[signer], Trust[intendedTo] and phaseTotal by
     *      `amount` in one shot (used for both the single-record path,
     *      amount=1, and the batch path, amount=len). Correctly detects
     *      and handles a wrap past type(uint256).max even when `amount`
     *      is added in a single step, and emits the same overflow events
     *      as the original one-at-a-time logic would have produced.
     */
    function _incrementCountersBy(
        address signer,
        address intendedTo,
        uint256 amount
    ) internal {

        // ---- PUSH ----
        uint256 currentPush = pushOf[signer];
        uint256 newPush;
        unchecked {
            newPush = currentPush + amount;
        }
        if (newPush < currentPush) {
            emit PushOverflow(signer, currentPush);
            pushOverflowCount[signer] += 1;
        }
        pushOf[signer] = newPush;

        // ---- TRUST ----
        uint256 currentTrust = trustOf[intendedTo];
        uint256 newTrust;
        unchecked {
            newTrust = currentTrust + amount;
        }
        if (newTrust < currentTrust) {
            emit TrustOverflow(intendedTo, currentTrust);
            trustOverflowCount[intendedTo] += 1;
        }
        trustOf[intendedTo] = newTrust;

        // ---- PHASE ----
        uint256 currentPhase = phaseTotal;
        uint256 newPhase;
        unchecked {
            newPhase = currentPhase + amount;
        }
        if (newPhase < currentPhase) {
            emit PhaseOverflow(currentPhase);
            phaseOverflowCount += 1;
        }
        phaseTotal = newPhase;
    }

    /**
     * @dev Verifies a 65-byte ECDSA signature over the EIP-712 typed
     *      digest binding signer + intendedTo + payloadHash + metadata
     *      to this contract and chain. Rejects malleable (high-s)
     *      signatures. Reverts InvalidSignature on any failure.
     *      Returns the struct hash so callers can reuse it as the dedup
     *      key without recomputing it a second time.
     */
    function _verifySignature(
        address expectedSigner,
        address intendedTo,
        bytes32 payloadHash,
        string calldata metadata,
        bytes calldata signature
    ) internal view returns (bytes32 structHash) {
        if (signature.length != 65) {
            revert InvalidSignature();
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > SECP256K1_HALF_ORDER) {
            revert InvalidSignature();
        }

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            revert InvalidSignature();
        }

        structHash = keccak256(
            abi.encode(
                RECORD_TYPEHASH,
                expectedSigner,
                intendedTo,
                payloadHash,
                keccak256(bytes(metadata))
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recovered = ecrecover(digest, v, r, s);

        if (recovered == address(0) || recovered != expectedSigner) {
            revert InvalidSignature();
        }
    }

    // ==================== ETH REJECTION ====================

    receive() external payable {
        revert NoETHAccepted();
    }

    fallback() external payable {
        revert NoETHAccepted();
    }
}
