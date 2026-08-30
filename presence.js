/**
 * 69069 Presence
 * Contract: 0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A (Ethereum Mainnet)
 *
 * ── Protocol (minimal scam-resistant flow) ──────────────────
 *   1. Poster   → O|1|{T|P}|{id24}|{qty}|{return}|{contact}
 *   2. Accepter → A|1|{T|P}|{id24}|{t1a|p1a}
 *   3. Closer   → D|1|{T|P}|{id24}|{c1}          (receiver confirms receipt)
 *   Optional    → X|1|{T|P}|{id24}|{x1}          (cancel)
 *
 * Who sends the first real-world SOS after Accept:
 *   TRUST (T) → Accepter sends first SOS to Poster
 *   PUSH  (P) → Poster   sends first SOS to Accepter
 *
 * After the real-world transfer, the party that received the value
 * is the one who emits the D (done) message.
 *
 * NOTE on metric counting: counts are derived ONLY from the dedicated
 * `code` field of parsed A/D/X action messages (parseActionMetadata),
 * never from a raw substring scan of the full metadata string. This
 * avoids a false-positive where a user's free-text "return / exchange"
 * value (e.g. typing "c1" or "x1") could otherwise be misread as a
 * completed/canceled event.
 *
 * NOTE on digit coloring: every metric value is rendered digit-by-digit
 * via colorizeDigits(), alternating two CSS color classes per digit
 * position (colorA, colorB, colorA, colorB, ...) so a 3-digit number
 * like "123" renders as colorA-colorB-colorA, a 4-digit number as
 * colorA-colorB-colorA-colorB, and so on.
 */

const SOS_ADDRESS = "0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A";
const ETH_CHAIN_ID = 1n;
const READ_RPC_FALLBACKS = [
  "https://ethereum.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
];

const SOS_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function pushCountOf(address user) view returns (uint256)",
  "function trustCountOf(address user) view returns (uint256)",
  "function effectiveOf(address user) view returns (int256)",
  "function statsOf(address user) view returns (uint256 pushCount, uint256 trustCount, int256 effective)",
  "function myStats() view returns (uint256 pushCount, uint256 trustCount, int256 effective)",
  "function totalSupply() view returns (uint256)",
  "function totalRecorded() view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
  "function recordStructHash(address signer, address intendedTo, bytes32 payloadHash, string metadata) pure returns (bytes32)",
  "function recordSignature(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)",
  "function isRecordHashUsed(bytes32 structHash) view returns (bool)",
  "event SignatureRecorded(address indexed signer, address indexed intendedTo, bytes32 payloadHash, bytes signature, address indexed submitter, uint256 timestamp, string metadata)",
  "error BatchTooLarge()",
  "error DuplicatePayloadHash()",
  "error EmptyBatch()",
  "error InvalidSignature()",
  "error LengthMismatch()",
  "error MetadataTooLong()",
  "error NoETHAccepted()",
  "error ZeroAddress()",
];

function decodeContractError(err) {
  const data =
    (err && err.data) ||
    (err && err.info && err.info.error && err.info.error.data) ||
    (err && err.error && err.error.data) ||
    null;

  if (!data) return null;

  try {
    const iface = new ethers.Interface(SOS_ABI);
    const parsed = iface.parseError(typeof data === "string" ? data : data.data);
    if (parsed) return parsed.name;
  } catch (_) {}
  return null;
}

const EIP712_DOMAIN = {
  name: "69069",
  version: "1",
  chainId: 1n,
  verifyingContract: SOS_ADDRESS,
};

const EIP712_TYPES = {
  Record: [
    { name: "signer", type: "address" },
    { name: "intendedTo", type: "address" },
    { name: "payloadHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
  ],
};

// ---------- DOM refs ----------
const connectButton = document.getElementById("connectButton");
const createOfferButton = document.getElementById("createOfferButton");
const lookupAddress = document.getElementById("lookupAddress");
const offerType = document.getElementById("offerType");
const offerQty = document.getElementById("offerQty");
const offerReturn = document.getElementById("offerReturn");
const metadataPreview = document.getElementById("metadataPreview");
const metadataLength = document.getElementById("metadataLength");
const typeExplanation = document.getElementById("typeExplanation");
const offersList = document.getElementById("offersList");

const elEffective = document.getElementById("myEffective");
const elTrust = document.getElementById("myTrust");
const elPush = document.getElementById("myPush");
const elOffers = document.getElementById("myOffers");
const elAccepted = document.getElementById("myAccepted");

const elCompleted = document.getElementById("mCompleted");
const elCanceled = document.getElementById("mCanceled");
const elOpen = document.getElementById("mOpen");

let provider = null;
let signer = null;
let contract = null;
let userAddress = null;
let currentFilter = "T";
let autoConnectAttempted = false;
let lastOffers = [];

// ---------- digit coloring ----------
/**
 * Render a numeric (or signed numeric) value as a string of <span>s,
 * alternating colorA/colorB per digit position: colorA, colorB, colorA,
 * colorB, ... A leading sign character ("-") is rendered in colorA and
 * does not count toward the digit alternation index.
 */
function colorizeDigits(value, colorA, colorB) {
  const str = String(value);
  let digitIndex = 0;
  return str.split("").map(function (ch) {
    if (!/[0-9]/.test(ch)) {
      return '<span class="' + colorA + '">' + ch + "</span>";
    }
    const cls = digitIndex % 2 === 0 ? colorA : colorB;
    digitIndex++;
    return '<span class="' + cls + '">' + ch + "</span>";
  }).join("");
}

// ---------- disconnect preference ----------
const DISCONNECT_KEY = "69069_user_disconnected";
function markDisconnected() {
  try { sessionStorage.setItem(DISCONNECT_KEY, "1"); } catch (_) {}
}
function clearDisconnectedFlag() {
  try { sessionStorage.removeItem(DISCONNECT_KEY); } catch (_) {}
}
function userPrefersDisconnected() {
  try { return sessionStorage.getItem(DISCONNECT_KEY) === "1"; } catch (_) { return false; }
}

const TYPE_HINTS = {
  T: "TRUST: accepter sends the first SOS to the poster. After receipt the receiver marks DONE. Optional CANCEL available.",
  P: "PUSH: poster sends the first SOS to the accepter. After receipt the receiver marks DONE. Optional CANCEL available.",
};

function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr || "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function makeOfferId() {
  const h = ethers.hexlify(ethers.randomBytes(12));
  return h.replace(/^0x/i, "").toLowerCase();
}

function buildOfferMetadata(type, qty, ret, contact, offerId) {
  const t = type === "P" ? "P" : "T";
  const q = String(Math.max(1, Number(qty) || 1));
  const r = String(ret || "").trim();
  const c = String(contact || "").trim();
  const id = (offerId || makeOfferId()).replace(/^0x/i, "").toLowerCase().slice(0, 24).padEnd(24, "0");
  return "O|1|" + t + "|" + id + "|" + q + "|" + r + "|" + c;
}

/** Accept metadata: A|1|{T|P}|{id24}|{t1a|p1a} */
function buildAcceptMetadata(type, offerId) {
  const t = type === "P" ? "P" : "T";
  const code = t === "P" ? "p1a" : "t1a";
  const id = String(offerId || "").replace(/^0x/i, "").toLowerCase().slice(0, 24).padEnd(24, "0");
  return "A|1|" + t + "|" + id + "|" + code;
}

/** Done metadata: D|1|{T|P}|{id24}|c1 */
function buildDoneMetadata(type, offerId) {
  const t = type === "P" ? "P" : "T";
  const id = String(offerId || "").replace(/^0x/i, "").toLowerCase().slice(0, 24).padEnd(24, "0");
  return "D|1|" + t + "|" + id + "|c1";
}

/** Cancel metadata: X|1|{T|P}|{id24}|x1 */
function buildCancelMetadata(type, offerId) {
  const t = type === "P" ? "P" : "T";
  const id = String(offerId || "").replace(/^0x/i, "").toLowerCase().slice(0, 24).padEnd(24, "0");
  return "X|1|" + t + "|" + id + "|x1";
}

function parseOfferMetadata(meta) {
  if (!meta || typeof meta !== "string") return null;
  const parts = meta.split("|");
  if (parts[0] !== "O" || parts.length < 5) return null;
  const type = parts[2];
  if (type !== "T" && type !== "P") return null;
  return {
    kind: "O",
    version: parts[1] || "1",
    type: type,
    id: parts[3] || "",
    qty: parts[4] || "1",
    ret: parts[5] || "",
    contact: parts[6] || "",
    raw: meta,
  };
}

function parseActionMetadata(meta) {
  if (!meta || typeof meta !== "string") return null;
  const parts = meta.split("|");
  if (parts.length < 5) return null;
  const kind = parts[0];
  if (kind !== "A" && kind !== "D" && kind !== "X") return null;
  const type = parts[2];
  if (type !== "T" && type !== "P") return null;
  return {
    kind: kind,
    version: parts[1] || "1",
    type: type,
    id: parts[3] || "",
    code: parts[4] || "",
    raw: meta,
  };
}

/**
 * Classify a parsed A/D/X action into one of the four tracked counters.
 * Only exact matches on the dedicated code field count — never a
 * substring scan of the raw metadata (which would be vulnerable to
 * free-text fields like "return / exchange" containing "c1"/"x1").
 */
function classifyAction(action) {
  if (!action) return null;
  if (action.kind === "A") {
    if (action.code === "t1a") return "trustAccepted";
    if (action.code === "p1a") return "pushAccepted";
  } else if (action.kind === "D") {
    if (action.code === "c1") return "completed";
  } else if (action.kind === "X") {
    if (action.code === "x1") return "canceled";
  }
  return null;
}

function emptyMetricCounts() {
  return {
    trustAccepted: 0,
    pushAccepted: 0,
    completed: 0,
    canceled: 0,
  };
}

function applyMetricsToUI(counts, offers) {
  const accepted = counts.trustAccepted + counts.pushAccepted;
  const openDeals = offers.filter(function (o) {
    return o.status === "OPEN" || o.status === "ACCEPTED";
  }).length;

  if (elOffers)    elOffers.innerHTML    = colorizeDigits(offers.length, "text-green", "text-blue");
  if (elAccepted)  elAccepted.innerHTML  = colorizeDigits(accepted, "text-green", "text-orange");
  if (elCompleted) elCompleted.innerHTML = colorizeDigits(counts.completed, "text-blue", "text-green");
  if (elCanceled)  elCanceled.innerHTML  = colorizeDigits(counts.canceled, "text-red", "text-blue");
  if (elOpen)       elOpen.innerHTML     = colorizeDigits(openDeals, "text-white", "text-green");
}

function ensureCreateActive() {
  if (createOfferButton) createOfferButton.disabled = false;
}

function setConnectedUI(address) {
  userAddress = address;
  if (connectButton) {
    connectButton.textContent = "CONNECTED";
    connectButton.classList.add("connected");
  }
  if (lookupAddress && address) lookupAddress.value = address;
  ensureCreateActive();
  updateMetadataPreview();
  refreshBalances(address);
  loadOffersAndMetrics(address);
  clearDisconnectedFlag();
}

function setDisconnectedUI() {
  userAddress = null;
  signer = null;
  contract = null;
  provider = null;
  if (connectButton) {
    connectButton.textContent = "CONNECT";
    connectButton.classList.remove("connected");
  }
  ensureCreateActive();
}

function disconnectWallet() {
  setDisconnectedUI();
  markDisconnected();
  loadOffersAndMetrics(null);
}

async function getEthereum() {
  if (typeof window.ethereum === "undefined") return null;
  return window.ethereum;
}

async function switchToMainnet(eth) {
  const chainId = await eth.request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
}

async function connectWallet(requestAccounts) {
  if (requestAccounts === undefined) requestAccounts = true;
  const eth = await getEthereum();
  if (!eth) {
    if (requestAccounts) {
      alert("No Ethereum wallet found. Install MetaMask or another Web3 wallet.");
    }
    return;
  }

  try {
    await switchToMainnet(eth);
    provider = new ethers.BrowserProvider(eth);

    let accounts;
    if (requestAccounts) {
      accounts = await provider.send("eth_requestAccounts", []);
    } else {
      accounts = await provider.send("eth_accounts", []);
    }
    if (!accounts || !accounts.length) {
      setDisconnectedUI();
      return;
    }

    const network = await provider.getNetwork();
    if (network.chainId !== ETH_CHAIN_ID) {
      throw new Error("Wrong network. Switch to Ethereum Mainnet.");
    }

    signer = await provider.getSigner();
    contract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, signer);
    const address = await signer.getAddress();
    setConnectedUI(address);

    if (eth.removeListener) {
      eth.removeListener("accountsChanged", onAccountsChanged);
      eth.removeListener("chainChanged", onChainChanged);
    }
    if (eth.on) {
      eth.on("accountsChanged", onAccountsChanged);
      eth.on("chainChanged", onChainChanged);
    }
  } catch (err) {
    console.error("Connect failed:", err);
    setDisconnectedUI();
  }
}

function onAccountsChanged(accounts) {
  if (!accounts || !accounts.length) {
    setDisconnectedUI();
    return;
  }
  setConnectedUI(accounts[0]);
  if (provider) {
    provider.getSigner().then(function (s) {
      signer = s;
      contract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, s);
    }).catch(function () {});
  }
}

function onChainChanged() {
  window.location.reload();
}

async function tryAutoConnect() {
  if (userAddress || autoConnectAttempted) return;
  if (userPrefersDisconnected()) return;
  const eth = typeof window.ethereum !== "undefined" ? window.ethereum : null;
  if (!eth) return;

  autoConnectAttempted = true;

  try {
    const existing = await eth.request({ method: "eth_accounts" });
    if (existing && existing.length > 0) {
      await connectWallet(false);
      return;
    }
  } catch (err) {
    console.warn("Auto-connect:", err);
    autoConnectAttempted = false;
  }
}

let readOnlyProvider = null;
let readOnlyContract = null;
let rpcIndex = 0;

function makeReadProvider(url) {
  return new ethers.JsonRpcProvider(url, undefined, {
    batchMaxCount: 1,
    staticNetwork: ethers.Network.from(1),
  });
}

function buildProviderFactories() {
  const factories = READ_RPC_FALLBACKS.map(function (url) {
    return { label: url, make: function () { return makeReadProvider(url); } };
  });
  if (provider) {
    factories.push({ label: "connected wallet", make: function () { return provider; } });
  } else if (typeof window.ethereum !== "undefined") {
    factories.push({
      label: "injected wallet",
      make: function () { return new ethers.BrowserProvider(window.ethereum); },
    });
  }
  return factories;
}

function getReadProvider() {
  if (readOnlyProvider) return readOnlyProvider;
  const factories = buildProviderFactories();
  readOnlyProvider = factories[rpcIndex].make();
  return readOnlyProvider;
}

function advanceReadProvider() {
  const factories = buildProviderFactories();
  if (rpcIndex >= factories.length - 1) return false;
  rpcIndex += 1;
  console.warn("Switching read provider to:", factories[rpcIndex].label);
  readOnlyProvider = factories[rpcIndex].make();
  readOnlyContract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, readOnlyProvider);
  return true;
}

async function withReadRetry(fn) {
  const factories = buildProviderFactories();
  let lastErr;
  for (let attempt = 0; attempt < factories.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn("Read failed on", factories[rpcIndex].label, "-", (err && err.shortMessage) || err);
      if (!advanceReadProvider()) break;
    }
  }
  throw lastErr;
}

function getReadContract() {
  if (readOnlyContract) return readOnlyContract;
  readOnlyContract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, getReadProvider());
  return readOnlyContract;
}

async function queryFilterChunked(c, filter, fromBlock, toBlock, chunkSize) {
  if (chunkSize === undefined) chunkSize = 5000;
  const results = [];
  let start = fromBlock;

  while (start <= toBlock) {
    let size = chunkSize;
    let succeeded = false;
    let lastErr = null;

    while (size >= 200 && !succeeded) {
      const end = Math.min(start + size - 1, toBlock);
      try {
        const chunk = await c.queryFilter(filter, start, end);
        results.push.apply(results, chunk);
        start = end + 1;
        succeeded = true;
      } catch (err) {
        lastErr = err;
        size = Math.floor(size / 2);
      }
    }

    if (!succeeded) {
      console.warn("queryFilterChunked: giving up on range starting at", start, lastErr);
      throw lastErr || new Error("Log query failed for block range starting at " + start);
    }
  }

  return results;
}

async function refreshBalances(address) {
  if (!address) return;
  try {
    await withReadRetry(async function () {
      const c = getReadContract();
      let pushCount, trustCount, effective;
      try {
        const stats = await c.statsOf(address);
        pushCount = stats.pushCount !== undefined ? stats.pushCount : stats[0];
        trustCount = stats.trustCount !== undefined ? stats.trustCount : stats[1];
        effective = stats.effective !== undefined ? stats.effective : stats[2];
      } catch (e1) {
        const t = await c.balanceOf(address).catch(function () { return c.trustCountOf(address); });
        const p = await c.pushCountOf(address);
        let e = null;
        try { e = await c.effectiveOf(address); } catch (e2) {}
        trustCount = t;
        pushCount = p;
        effective = e != null ? e : BigInt(t) - BigInt(p);
      }
      if (elTrust) elTrust.innerHTML = colorizeDigits(trustCount, "text-green", "text-red");
      if (elPush) elPush.innerHTML = colorizeDigits(pushCount, "text-red", "text-green");
      if (elEffective) elEffective.innerHTML = colorizeDigits(effective, "text-blue", "text-red");
    });
  } catch (err) {
    console.warn("Balance read failed:", err);
  }
}

function updateMetadataPreview() {
  const type = (offerType && offerType.value) || "T";
  const qty = (offerQty && offerQty.value) || "1";
  const ret = (offerReturn && offerReturn.value) || "";
  const meta = buildOfferMetadata(type, qty, ret, "", "xxxxxxxxxxxxxxxxxxxxxxxx");
  if (metadataPreview) metadataPreview.textContent = meta || "—";
  if (metadataLength) metadataLength.textContent = String(meta.length);
  if (typeExplanation) typeExplanation.textContent = TYPE_HINTS[type] || TYPE_HINTS.T;
  ensureCreateActive();
}

/**
 * Shared helper: sign + submit a recordSignature call.
 */
async function submitRecord(metadata, intendedTo) {
  if (!userAddress || !signer || !contract) {
    throw new Error("Wallet not connected");
  }
  if (metadata.length > 64) {
    throw new Error("Metadata exceeds 64 characters");
  }

  const payloadHash = ethers.keccak256(
    ethers.solidityPacked(
      ["address", "string", "uint256", "uint256"],
      [userAddress, metadata, BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1e9))]
    )
  );

  const structHash = await contract.recordStructHash(
    userAddress,
    intendedTo,
    payloadHash,
    metadata
  );

  const domainSep = await contract.domainSeparator();
  const digest = ethers.keccak256(
    ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domainSep, structHash])
  );

  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));
  const typedValue = { signer: userAddress, intendedTo, payloadHash, metadataHash };

  const localStructHash = ethers.TypedDataEncoder.hashStruct("Record", EIP712_TYPES, typedValue);
  if (localStructHash.toLowerCase() !== String(structHash).toLowerCase()) {
    throw new Error(
      "Local EIP-712 struct hash does not match on-chain recordStructHash(). " +
      "Domain/type definition is out of sync with the deployed contract."
    );
  }

  const signature = await signer.signTypedData(EIP712_DOMAIN, EIP712_TYPES, typedValue);

  try {
    const recovered = ethers.recoverAddress(digest, signature);
    if (recovered.toLowerCase() !== userAddress.toLowerCase()) {
      console.warn("Signature does not recover to signer over raw digest.", recovered, userAddress);
    }
  } catch (_) {}

  const tx = await contract.recordSignature(
    userAddress,
    intendedTo,
    payloadHash,
    signature,
    metadata
  );
  return tx.wait();
}

async function createOffer() {
  if (!userAddress || !signer || !contract) {
    await connectWallet(true);
    if (!userAddress || !signer || !contract) {
      alert("Connect your wallet first.");
      return;
    }
  }

  const qty = Number(offerQty.value || 0);
  if (qty < 1) {
    alert("Quantity must be at least 1.");
    return;
  }

  const type = offerType.value === "P" ? "P" : "T";
  const ret = String(offerReturn.value || "").trim();
  const contact = "";
  const offerId = makeOfferId();
  const metadata = buildOfferMetadata(type, qty, ret, contact, offerId);

  createOfferButton.disabled = true;
  createOfferButton.textContent = "SIGNING…";

  try {
    createOfferButton.textContent = "SUBMITTING…";
    const receipt = await submitRecord(metadata, userAddress);

    alert(
      "Offer posted on-chain.\n\n" +
        "Type: " + type + "\n" +
        "#" + offerId + "\n" +
        "Quantity: " + qty + "\n" +
        "Return: " + (ret || "(none)") + "\n" +
        "Metadata: " + metadata + "\n" +
        "Tx: " + receipt.hash
    );

    await refreshBalances(userAddress);
    await loadOffersAndMetrics(userAddress);
  } catch (err) {
    console.error("createOffer failed:", err);
    const decoded = decodeContractError(err);
    const msg =
      decoded ||
      (err && (err.shortMessage || err.reason || err.message)) ||
      "Create failed";
    alert(msg);
  } finally {
    createOfferButton.textContent = "CREATE";
    createOfferButton.disabled = false;
  }
}

/**
 * Accept an offer → record A|1|{T|P}|{id}|{t1a|p1a}
 */
async function acceptOffer(offer) {
  if (!userAddress || !signer || !contract) {
    await connectWallet(true);
    if (!userAddress || !signer || !contract) {
      alert("Connect your wallet first.");
      return;
    }
  }

  if (!offer || !offer.id || !offer.signer) {
    alert("Invalid offer.");
    return;
  }

  if (String(offer.signer).toLowerCase() === userAddress.toLowerCase()) {
    alert("You cannot accept your own offer.");
    return;
  }

  if (offer.status && offer.status !== "OPEN") {
    alert("This offer is no longer open for acceptance.");
    return;
  }

  const metadata = buildAcceptMetadata(offer.type, offer.id);
  const intendedTo = offer.signer;

  const btn = document.querySelector(
    'button.accept-btn[data-offer-id="' + offer.id + '"]'
  );
  if (btn) {
    btn.disabled = true;
    btn.textContent = "SIGNING…";
  }

  try {
    if (btn) btn.textContent = "SUBMITTING…";
    const receipt = await submitRecord(metadata, intendedTo);

    alert(
      "Offer accepted on-chain.\n\n" +
        "Type: " + offer.type + "\n" +
        "#" + offer.id + "\n" +
        "Metadata: " + metadata + "\n" +
        "Tx: " + receipt.hash
    );

    await refreshBalances(userAddress);
    await loadOffersAndMetrics(userAddress);
  } catch (err) {
    console.error("acceptOffer failed:", err);
    const decoded = decodeContractError(err);
    const msg =
      decoded ||
      (err && (err.shortMessage || err.reason || err.message)) ||
      "Accept failed";
    alert(msg);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "ACCEPT";
    }
  }
}

/**
 * Mark done → record D|1|{T|P}|{id}|c1
 */
async function markDone(offer) {
  if (!userAddress || !signer || !contract) {
    await connectWallet(true);
    if (!userAddress || !signer || !contract) {
      alert("Connect your wallet first.");
      return;
    }
  }

  if (!offer || !offer.id) {
    alert("Invalid offer.");
    return;
  }

  if (offer.status === "DONE") {
    alert("This offer is already marked DONE.");
    return;
  }
  if (offer.status === "CANCELED") {
    alert("This offer was canceled.");
    return;
  }

  const metadata = buildDoneMetadata(offer.type, offer.id);
  const intendedTo =
    String(offer.signer).toLowerCase() === userAddress.toLowerCase()
      ? (offer.accepter || offer.signer)
      : offer.signer;

  const btn = document.querySelector(
    'button.done-btn[data-offer-id="' + offer.id + '"]'
  );
  if (btn) {
    btn.disabled = true;
    btn.textContent = "SIGNING…";
  }

  try {
    if (btn) btn.textContent = "SUBMITTING…";
    const receipt = await submitRecord(metadata, intendedTo);

    alert(
      "Deal marked DONE on-chain.\n\n" +
        "Type: " + offer.type + "\n" +
        "#" + offer.id + "\n" +
        "Metadata: " + metadata + "\n" +
        "Tx: " + receipt.hash
    );

    await refreshBalances(userAddress);
    await loadOffersAndMetrics(userAddress);
  } catch (err) {
    console.error("markDone failed:", err);
    const decoded = decodeContractError(err);
    const msg =
      decoded ||
      (err && (err.shortMessage || err.reason || err.message)) ||
      "Mark Done failed";
    alert(msg);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "MARK DONE";
    }
  }
}

/**
 * Cancel → record X|1|{T|P}|{id}|x1
 */
async function cancelOffer(offer) {
  if (!userAddress || !signer || !contract) {
    await connectWallet(true);
    if (!userAddress || !signer || !contract) {
      alert("Connect your wallet first.");
      return;
    }
  }

  if (!offer || !offer.id) {
    alert("Invalid offer.");
    return;
  }

  if (offer.status === "DONE") {
    alert("Cannot cancel a completed deal.");
    return;
  }
  if (offer.status === "CANCELED") {
    alert("This offer is already canceled.");
    return;
  }

  const metadata = buildCancelMetadata(offer.type, offer.id);
  const intendedTo =
    String(offer.signer).toLowerCase() === userAddress.toLowerCase()
      ? (offer.accepter || offer.signer)
      : offer.signer;

  const btn = document.querySelector(
    'button.cancel-btn[data-offer-id="' + offer.id + '"]'
  );
  if (btn) {
    btn.disabled = true;
    btn.textContent = "SIGNING…";
  }

  try {
    if (btn) btn.textContent = "SUBMITTING…";
    const receipt = await submitRecord(metadata, intendedTo);

    alert(
      "Offer canceled on-chain.\n\n" +
        "Type: " + offer.type + "\n" +
        "#" + offer.id + "\n" +
        "Metadata: " + metadata + "\n" +
        "Tx: " + receipt.hash
    );

    await refreshBalances(userAddress);
    await loadOffersAndMetrics(userAddress);
  } catch (err) {
    console.error("cancelOffer failed:", err);
    const decoded = decodeContractError(err);
    const msg =
      decoded ||
      (err && (err.shortMessage || err.reason || err.message)) ||
      "Cancel failed";
    alert(msg);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "CANCEL";
    }
  }
}

async function loadOffersAndMetrics(forAddress) {
  if (!offersList) return;
  offersList.innerHTML =
    '<p class="muted" style="font-size:14px;font-weight:400;">Loading offers…</p>';

  try {
    const offers = [];
    const counts = emptyMetricCounts();
    const addr = (forAddress || userAddress || "").toLowerCase();

    const actionsById = {};

    const events = await withReadRetry(async function () {
      const c = getReadContract();
      const filter = c.filters.SignatureRecorded();
      const latest = await getReadProvider().getBlockNumber();
      const fromBlock = Math.max(0, latest - 120000);
      return queryFilterChunked(c, filter, fromBlock, latest, 5000);
    });

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const meta = (ev.args && (ev.args.metadata !== undefined ? ev.args.metadata : ev.args[6])) || "";
      const signerAddr = ev.args && (ev.args.signer !== undefined ? ev.args.signer : ev.args[0]);
      const intendedTo = ev.args && (ev.args.intendedTo !== undefined ? ev.args.intendedTo : ev.args[1]);
      const payloadHash = ev.args && (ev.args.payloadHash !== undefined ? ev.args.payloadHash : ev.args[2]);
      const ts = ev.args && (ev.args.timestamp !== undefined ? ev.args.timestamp : ev.args[5]);

      const action = parseActionMetadata(meta);

      // Only count metrics from the dedicated action code field of a
      // genuine A/D/X message — never from a raw scan of free-text
      // fields (e.g. the offer's "return / exchange" value).
      if (action) {
        const involvesUser =
          !addr ||
          (signerAddr && String(signerAddr).toLowerCase() === addr) ||
          (intendedTo && String(intendedTo).toLowerCase() === addr);

        if (involvesUser) {
          const bucket = classifyAction(action);
          if (bucket) counts[bucket]++;
        }
      }

      if (action && action.id) {
        if (!actionsById[action.id]) {
          actionsById[action.id] = { accepts: [], dones: [], cancels: [] };
        }
        const entry = {
          kind: action.kind,
          type: action.type,
          code: action.code,
          signer: signerAddr,
          intendedTo: intendedTo,
          timestamp: Number(ts || 0),
          txHash: ev.transactionHash,
          raw: action.raw,
        };
        if (action.kind === "A") actionsById[action.id].accepts.push(entry);
        else if (action.kind === "D") actionsById[action.id].dones.push(entry);
        else if (action.kind === "X") actionsById[action.id].cancels.push(entry);
      }

      const parsed = parseOfferMetadata(meta);
      if (!parsed) continue;

      offers.push({
        kind: parsed.kind,
        version: parsed.version,
        type: parsed.type,
        id: parsed.id,
        qty: parsed.qty,
        ret: parsed.ret,
        contact: parsed.contact,
        raw: parsed.raw,
        signer: signerAddr,
        payloadHash: payloadHash ? String(payloadHash) : "",
        timestamp: Number(ts || 0),
        txHash: ev.transactionHash,
      });
    }

    // Attach status + related parties
    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      const acts = actionsById[o.id] || { accepts: [], dones: [], cancels: [] };

      o.accepter = acts.accepts.length ? acts.accepts[0].signer : null;
      o.acceptTx = acts.accepts.length ? acts.accepts[0].txHash : null;
      o.doneBy = acts.dones.length ? acts.dones[0].signer : null;
      o.doneTx = acts.dones.length ? acts.dones[0].txHash : null;
      o.canceledBy = acts.cancels.length ? acts.cancels[0].signer : null;
      o.cancelTx = acts.cancels.length ? acts.cancels[0].txHash : null;

      if (acts.cancels.length) {
        o.status = "CANCELED";
      } else if (acts.dones.length) {
        o.status = "DONE";
      } else if (acts.accepts.length) {
        o.status = "ACCEPTED";
      } else {
        o.status = "OPEN";
      }
    }

    offers.sort(function (a, b) { return b.timestamp - a.timestamp; });
    lastOffers = offers;

    applyMetricsToUI(counts, offers);
    renderOffers(offers);
  } catch (err) {
    console.warn("loadOffersAndMetrics failed:", err);
    const reason =
      (err && (err.shortMessage || err.reason || err.message)) || "Unknown error";
    offersList.innerHTML =
      '<p class="muted" style="font-size:14px;font-weight:400;">Could not load offers: ' +
      reason.replace(/</g, "&lt;") +
      "<br><br>If you opened the page as a local file (file://), public RPCs return 403. " +
      "Connect your wallet or serve the page over http://localhost.</p>";
  }
}

function renderOffers(offers) {
  if (!offersList) return;

  let list = offers;
  if (currentFilter === "T") list = offers.filter(function (o) { return o.type === "T"; });
  else if (currentFilter === "P") list = offers.filter(function (o) { return o.type === "P"; });
  else if (currentFilter === "OPEN") list = offers.filter(function (o) { return o.status === "OPEN"; });
  else if (currentFilter === "ACCEPTED") list = offers.filter(function (o) { return o.status === "ACCEPTED"; });
  else if (currentFilter === "DONE") list = offers.filter(function (o) { return o.status === "DONE"; });
  else if (currentFilter === "CANCELED") list = offers.filter(function (o) { return o.status === "CANCELED"; });

  if (!list.length) {
    offersList.innerHTML =
      '<p class="muted" style="font-size:14px;font-weight:400;">No offers found.</p>';
    return;
  }

  const myAddr = (userAddress || "").toLowerCase();

  offersList.innerHTML = list.map(function (o) {
    const title = o.type === "P" ? "PUSH PRESENCE" : "TRUST PRESENCE";
    const border =
      o.type === "P"
        ? "border-left:3px solid var(--brand-blue-soft);"
        : "border-left:3px solid var(--brand-green-bright);";
    const when = o.timestamp
      ? new Date(o.timestamp * 1000).toLocaleString()
      : "—";
    const idShow = o.id ? "#" + o.id : "";
    const isMine = myAddr && o.signer && String(o.signer).toLowerCase() === myAddr;
    const isAccepter = myAddr && o.accepter && String(o.accepter).toLowerCase() === myAddr;
    const status = o.status || "OPEN";

    let html = "";
    html += '<div class="presence-card" style="' + border + '">';
    html += '<div class="presence-title"><strong>' + title + '</strong> <span class="offer-id">' + idShow + '</span>';
    html += '<span class="status-badge status-' + status + '">' + status + '</span></div>';

    html += '<div class="address-mini"><strong>Poster</strong> ' + shortAddr(o.signer) + "</div>";
    if (o.accepter) {
      html += '<div class="address-mini"><strong>Accepter</strong> ' + shortAddr(o.accepter) + "</div>";
    }
    html += '<div class="address-mini"><strong>Quantity</strong> ' + o.qty + "</div>";
    html += '<div class="address-mini"><strong>Return</strong> ' + (o.ret || "—") + "</div>";
    if (o.contact) html += '<div class="address-mini"><strong>Contact</strong> ' + o.contact + "</div>";
    html += '<div class="address-mini" style="margin-top:6px;">' + when + "</div>";
    html += '<div class="address-mini" style="margin-top:8px;"><strong>Metadata</strong></div>';
    html += '<div class="address-mini" style="word-break:break-all;">' + o.raw + "</div>";
    if (o.payloadHash) {
      html += '<div class="address-mini" style="margin-top:6px;"><strong>Offer payload</strong></div>';
      html += '<div class="address-mini" style="word-break:break-all;">' + o.payloadHash + "</div>";
    }
    if (o.txHash) {
      html += '<p style="margin-top:8px;"><a href="https://etherscan.io/tx/' + o.txHash + '" target="_blank" rel="noopener">Offer Tx ↗</a></p>';
    }
    if (o.acceptTx) {
      html += '<p style="margin-top:4px;"><a href="https://etherscan.io/tx/' + o.acceptTx + '" target="_blank" rel="noopener">Accept Tx ↗</a></p>';
    }
    if (o.doneTx) {
      html += '<p style="margin-top:4px;"><a href="https://etherscan.io/tx/' + o.doneTx + '" target="_blank" rel="noopener">Done Tx ↗</a></p>';
    }
    if (o.cancelTx) {
      html += '<p style="margin-top:4px;"><a href="https://etherscan.io/tx/' + o.cancelTx + '" target="_blank" rel="noopener">Cancel Tx ↗</a></p>';
    }

    if (userAddress) {
      html += '<div class="action-buttons">';

      if (status === "OPEN" && !isMine) {
        html +=
          '<button class="accept-btn btn-green" data-offer-id="' +
          o.id +
          '" data-type="' +
          o.type +
          '">ACCEPT</button>';
      }

      if ((status === "OPEN" || status === "ACCEPTED") && (isMine || isAccepter)) {
        html +=
          '<button class="cancel-btn" data-offer-id="' +
          o.id +
          '" style="background:var(--danger);color:#fff;">CANCEL</button>';
      }

      if (status === "ACCEPTED" && (isMine || isAccepter)) {
        html +=
          '<button class="done-btn btn-green" data-offer-id="' +
          o.id +
          '">MARK DONE</button>';
      }

      if (isMine && status === "OPEN") {
        html += '<div class="address-mini" style="margin-top:8px;color:var(--text-dim);">Your offer – waiting for accepter</div>';
      }

      html += "</div>";
    } else if (isMine) {
      html += '<div class="address-mini" style="margin-top:8px;color:var(--text-dim);">Your offer</div>';
    }

    html += "</div>";
    return html;
  }).join("");

  // Wire buttons
  offersList.querySelectorAll("button.accept-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-offer-id");
      const offer = lastOffers.find(function (o) { return o.id === id; });
      if (offer) acceptOffer(offer);
    });
  });

  offersList.querySelectorAll("button.done-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-offer-id");
      const offer = lastOffers.find(function (o) { return o.id === id; });
      if (offer) markDone(offer);
    });
  });

  offersList.querySelectorAll("button.cancel-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-offer-id");
      const offer = lastOffers.find(function (o) { return o.id === id; });
      if (offer) cancelOffer(offer);
    });
  });
}

// ---------- Event listeners ----------
document.querySelectorAll(".filters button").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".filters button").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    currentFilter = btn.getAttribute("data-filter") || "ALL";
    renderOffers(lastOffers);
  });
});

if (connectButton) {
  connectButton.addEventListener("click", function () {
    if (userAddress) {
      disconnectWallet();
      return;
    }
    connectWallet(true);
  });
}

if (createOfferButton) {
  createOfferButton.addEventListener("click", function () {
    createOffer();
  });
}

if (offerType) offerType.addEventListener("change", updateMetadataPreview);
if (offerQty) offerQty.addEventListener("input", updateMetadataPreview);
if (offerReturn) offerReturn.addEventListener("input", updateMetadataPreview);

if (lookupAddress) {
  lookupAddress.addEventListener("change", function () {
    const v = (lookupAddress.value || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(v)) {
      refreshBalances(v);
      loadOffersAndMetrics(v);
    }
  });
}

ensureCreateActive();
updateMetadataPreview();

function scheduleAutoConnect() {
  setTimeout(function () {
    tryAutoConnect();
  }, 400);
  setTimeout(function () {
    if (!userAddress) {
      autoConnectAttempted = false;
      tryAutoConnect();
    }
  }, 1500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleAutoConnect);
} else {
  scheduleAutoConnect();
}

window.addEventListener("load", function () {
  setTimeout(function () {
    if (!userAddress) {
      autoConnectAttempted = false;
      tryAutoConnect();
    }
  }, 500);
});

window.addEventListener("ethereum#initialized", function () {
  if (!userAddress) {
    autoConnectAttempted = false;
    tryAutoConnect();
  }
});

// Initial load
loadOffersAndMetrics(null);

window.SOS_ADDRESS = SOS_ADDRESS;
window.refreshBalances = refreshBalances;
window.loadOffers = function () { return loadOffersAndMetrics(userAddress); };
window.buildOfferMetadata = buildOfferMetadata;
window.buildAcceptMetadata = buildAcceptMetadata;
window.buildDoneMetadata = buildDoneMetadata;
window.buildCancelMetadata = buildCancelMetadata;
