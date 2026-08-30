// ============================================================
//  69069 Ledger – CHECK feed + REPLY send (messages.html parity)
// ============================================================
const CONTRACT_ADDRESS = "0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A";
const DEFAULT_ADDRESS = "0x1C10e6574ee696f54b21A611a21313E4714628ad";
const MAX_METADATA_LENGTH = 64;
const MAX_TX_SHOW = 10;
const LOOKBACK = 80000;

const RPC_LIST = [
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.flashbots.net",
  "https://cloudflare-eth.com"
];

const ABI = [
  "function statsOf(address) view returns (uint256 pushCount, uint256 trustCount, int256 effective)",
  "function recordSignature(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)",
  "event SignatureRecorded(address indexed signer, address indexed intendedTo, bytes32 payloadHash, bytes signature, address indexed submitter, uint256 timestamp, string metadata)"
];

const EIP712_TYPES = {
  Record: [
    { name: "signer", type: "address" },
    { name: "intendedTo", type: "address" },
    { name: "payloadHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" }
  ]
};

let provider, signer, contract, readProvider, readContract;
let userAddress = null;
let monitoringAddress = null; // address currently shown in the feed (reply target)
let chainId = 1n;

const ensCache = new Map();
const seenTx = new Set();

// ---------- helpers ----------
function short(a) {
  return a ? a.slice(0, 6) + "..." + a.slice(-4) : "";
}

function setStatus(text, type) {
  const el = document.getElementById("status");
  if (!el) return;
  el.innerText = text;
  el.className = "";
  if (type === "connected") el.classList.add("status-connected");
  else if (type === "error") el.classList.add("status-error");
  else if (type === "warning") el.classList.add("status-warning");
  else if (type === "info") el.classList.add("status-info");
}

function setConnectButtonText(text) {
  const el = document.getElementById("connectButton");
  if (el) el.textContent = text;
}

function setAddress(addr, method) {
  let html = addr || "-";
  if (method === "extension") {
    html += ' <span class="method-badge badge-extension">&#128058; Extension</span>';
  } else if (method === "walletconnect") {
    html += ' <span class="method-badge badge-walletconnect">&#128241; Mobile</span>';
  }
  const el = document.getElementById("address");
  if (el) el.innerHTML = html;
}

function utf8ByteLength(str) {
  return new TextEncoder().encode(str || "").length;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(Number(ts) * 1000).toLocaleString();
  } catch (_) {
    return "";
  }
}

function extractConvCode(metadata) {
  const s = (metadata || "").toString().trim();
  const m = s.match(/(?:^|\s)([a-fA-F0-9]{8})$/);
  return m ? m[1].toLowerCase() : null;
}

function hasMetadata(parsed) {
  const meta = (parsed.args.metadata || "").toString().trim();
  return meta.length > 0;
}

// ---------- providers ----------
async function getReadProvider() {
  if (readProvider) return readProvider;
  if (provider) {
    readProvider = provider;
    return readProvider;
  }
  for (const url of RPC_LIST) {
    try {
      const p = new ethers.JsonRpcProvider(url, 1, { staticNetwork: true });
      await p.getBlockNumber();
      readProvider = p;
      return p;
    } catch (e) {
      console.warn("RPC failed", url, e);
    }
  }
  try {
    readProvider = ethers.getDefaultProvider("homestead");
    return readProvider;
  } catch (e) {
    console.warn("No read provider", e);
    return null;
  }
}

async function getReadContract() {
  if (contract) return contract;
  if (readContract) return readContract;
  const p = await getReadProvider();
  if (!p) return null;
  readContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, p);
  return readContract;
}

// Chunk size kept modest since many free public RPCs reject/HTTP-400
// eth_getLogs requests that span too many blocks in one call.
const LOG_CHUNK_SIZE = 5000;

// Runs one or more filters over [fromBlock, toBlock], chunked, and
// automatically retries on the next RPC in RPC_LIST if the current
// provider errors out (e.g. "server response 400").
async function queryFiltersWithFallback(filters, fromBlock, toBlock) {
  const candidateUrls = provider ? [null] : RPC_LIST; // if wallet-connected, no fallback needed/possible
  let lastErr = null;

  for (const url of candidateUrls) {
    try {
      const p = url ? new ethers.JsonRpcProvider(url, 1, { staticNetwork: true }) : await getReadProvider();
      if (!p) continue;
      const c = new ethers.Contract(CONTRACT_ADDRESS, ABI, p);

      const results = filters.map(() => []);
      for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_SIZE) {
        const end = Math.min(start + LOG_CHUNK_SIZE - 1, toBlock);
        for (let i = 0; i < filters.length; i++) {
          const chunk = await c.queryFilter(filters[i], start, end);
          results[i].push(...chunk);
        }
      }

      // Success: remember this provider/contract for subsequent calls.
      readProvider = p;
      readContract = c;
      return results;
    } catch (e) {
      console.warn("queryFiltersWithFallback: RPC failed, trying next", url || "(current)", e);
      lastErr = e;
      readProvider = null;
      readContract = null;
      continue;
    }
  }
  throw lastErr || new Error("All RPC endpoints failed");
}

// ---------- ENS ----------
async function resolveEnsName(addr) {
  if (!addr) return null;
  const key = addr.toLowerCase();
  if (ensCache.has(key)) return ensCache.get(key);
  try {
    const p = await getReadProvider();
    if (!p) return null;
    const name = await p.lookupAddress(addr);
    ensCache.set(key, name || null);
    return name || null;
  } catch (_) {
    ensCache.set(key, null);
    return null;
  }
}

async function resolveEnsAddress(nameOrAddr) {
  const s = (nameOrAddr || "").trim();
  if (!s) return null;
  if (ethers.isAddress(s)) return ethers.getAddress(s);
  if (s.toLowerCase().endsWith(".eth")) {
    try {
      const p = await getReadProvider();
      if (!p) return null;
      const addr = await p.resolveName(s);
      return addr ? ethers.getAddress(addr) : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

// ---------- setReplyCode (used by REPLY links in feed) ----------
function setReplyCode(code) {
  const el = document.getElementById("replyCode");
  if (el && code) {
    el.value = code;
    el.dispatchEvent(new Event("input"));
  }
  const card = document.getElementById("replyCard");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}
window.setReplyCode = setReplyCode;

// ---------- Render one event – same structure as messages.html ----------
function renderMessageEvent(direction, parsed, log) {
  const key = (log.transactionHash || "") + "-" + (log.index !== undefined ? log.index : 0);
  if (seenTx.has(key)) return "";
  seenTx.add(key);

  const party = direction === "push"
    ? (parsed.args.intendedTo || "")
    : (parsed.args.signer || "");

  const ts = Number(parsed.args.timestamp || 0);
  const meta = (parsed.args.metadata || "").toString();
  const when = formatTime(ts);
  const blockNum = log.blockNumber || "?";
  const txHash = log.transactionHash || "";
  const txDisplay = "tx" + (txHash ? txHash.slice(0, 35) : "");

  const convCode = extractConvCode(meta);
  const rootCode = (txHash && txHash.length >= 10) ? txHash.slice(2, 10).toLowerCase() : "";
  const replyCode = convCode || rootCode;
  const replyLabel = convCode
    ? "REPLY"
    : (rootCode ? "REPLY (start conv " + rootCode + ")" : "");

  const dirClass = direction === "push" ? "dir-out" : "dir-in";
  const dirLabel = direction === "push" ? "PUSH Sent 1 SOS" : "TRUST Received 1 SOS";

  let html = '<div class="event" style="padding:8px 0;">';

  // 1. metadata
  if (meta && meta.trim()) {
    html += '<div class="metadata-msg">' + escapeHtml(meta) + "</div>";
  }

  // 2. address
  html += '<div class="meta" style="margin:0;"><span class="sender">' +
    escapeHtml(party) + "</span></div>";

  // 3. tx
  html +=
    '<a href="https://etherscan.io/tx/' + txHash +
    '" target="_blank" rel="noopener" style="margin:0;display:inline;">' +
    txDisplay + "</a>";

  // 4. block · time
  html +=
    '<div class="meta" style="margin:0;">· block ' + blockNum +
    (when ? " · " + when : "") + "</div>";

  // 5. direction · REPLY
  html +=
    '<div class="' + dirClass + '" style="margin:2px 0 0 0;">' + dirLabel +
    (replyLabel
      ? ' · <a href="javascript:void(0)" onclick="setReplyCode(\'' +
        escapeHtml(replyCode) +
        '\')" style="font-size:13px;color:var(--brand-yellow);font-weight:700;">' +
        replyLabel +
        "</a>"
      : "") +
    "</div>";

  html += "</div>";
  return html;
}

// ---------- CHECK: load messages for address (or global if empty) ----------
async function runCheck() {
  const list = document.getElementById("feedResults");
  const btn = document.getElementById("lookupBtn");
  if (!list) return;

  const raw = (document.getElementById("lookupAddress")?.value || "").trim();
  btn.disabled = true;
  list.innerHTML = '<div class="feed-empty">Loading…</div>';
  seenTx.clear();

  try {
    const p = await getReadProvider();
    if (!p) {
      list.innerHTML = '<div class="feed-empty">Provider unavailable</div>';
      return;
    }

    const latest = await p.getBlockNumber();
    const fromBlock = Math.max(0, latest - LOOKBACK);

    let events = [];
    let targetAddr = null;

    // Need a throwaway contract instance just to build filter objects
    // (queryFiltersWithFallback builds its own contract per RPC attempt).
    const filterFactory = new ethers.Contract(CONTRACT_ADDRESS, ABI, p);

    if (!raw) {
      // Global: most recent messages with metadata
      const filter = filterFactory.filters.SignatureRecorded();
      const [rawEvents] = await queryFiltersWithFallback([filter], fromBlock, latest);
      events = rawEvents.filter(hasMetadata);
      events.sort((a, b) => Number(b.args.timestamp) - Number(a.args.timestamp));
      events = events.slice(0, MAX_TX_SHOW);
      monitoringAddress = DEFAULT_ADDRESS;
    } else {
      targetAddr = await resolveEnsAddress(raw);
      if (!targetAddr) {
        list.innerHTML =
          '<div class="feed-empty">Could not resolve “' +
          escapeHtml(raw) +
          '”</div>';
        return;
      }
      monitoringAddress = targetAddr;

      const toFilter = filterFactory.filters.SignatureRecorded(null, targetAddr);
      const fromFilter = filterFactory.filters.SignatureRecorded(targetAddr, null);
      const [toEv, fromEv] = await queryFiltersWithFallback([toFilter, fromFilter], fromBlock, latest);

      const all = [...toEv, ...fromEv].filter(hasMetadata);
      const seen = new Set();
      const unique = [];
      for (const ev of all) {
        const key = ev.transactionHash + ":" + ev.index;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ev);
      }
      unique.sort((a, b) => Number(b.args.timestamp) - Number(a.args.timestamp));
      events = unique.slice(0, MAX_TX_SHOW);
    }

    if (events.length === 0) {
      list.innerHTML =
        '<div class="feed-empty">No messages with metadata found</div>';
      return;
    }

    let html = "";
    for (const log of events) {
      const parsed = log;
      let direction = "trust";
      if (targetAddr) {
        const signer = (parsed.args.signer || "").toLowerCase();
        if (signer === targetAddr.toLowerCase()) direction = "push";
        else direction = "trust";
      } else {
        direction = "trust";
      }
      html += renderMessageEvent(direction, parsed, log);
    }
    list.innerHTML = html || '<div class="feed-empty">No messages</div>';
  } catch (e) {
    console.error("runCheck", e);
    list.innerHTML =
      '<div class="feed-empty">Check failed: ' +
      escapeHtml(e?.shortMessage || e?.message || String(e)) +
      "</div>";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("lookupBtn").onclick = () => runCheck();
document.getElementById("lookupAddress")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runCheck();
  }
});

// ---------- Connect / Disconnect ----------
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

async function connectWallet(silent) {
  if (!window.ethereum) {
    if (!silent) {
      setStatus("No wallet found - install MetaMask", "error");
      alert("No injected wallet found. Please install MetaMask.");
    }
    return null;
  }

  provider = new ethers.BrowserProvider(window.ethereum);

  if (silent) {
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts || !accounts[0]) return null;
  } else {
    await provider.send("eth_requestAccounts", []);
  }

  signer = await provider.getSigner();
  userAddress = await signer.getAddress();
  const network = await provider.getNetwork();
  chainId = network.chainId;

  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  readProvider = provider;
  readContract = contract;

  setAddress(userAddress, "extension");
  setStatus("Connected", "connected");
  setConnectButtonText("DISCONNECT");
  clearDisconnectedFlag();
  return userAddress;
}

function disconnectWallet() {
  signer = null;
  contract = null;
  userAddress = null;
  setAddress("Read-only mode", "");
  setStatus("Disconnected", "warning");
  setConnectButtonText("CONNECT");
  markDisconnected();
}

document.getElementById("connectButton")?.addEventListener("click", async () => {
  if (userAddress) {
    disconnectWallet();
    return;
  }
  await connectWallet(false);
});

if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (accounts && accounts[0]) {
      await connectWallet(true);
    } else {
      disconnectWallet();
    }
  });
  window.ethereum.on("chainChanged", () => {
    window.location.reload();
  });
}

// ---------- REPLY SEND (exact messages.html behaviour) ----------
function updateReplyCount() {
  const code = (document.getElementById("replyCode").value || "").trim();
  const limit = /^[a-fA-F0-9]{8}$/.test(code) ? 56 : 64;
  const text = document.getElementById("replyText").value || "";
  const len = utf8ByteLength(text);
  const el = document.getElementById("replyCount");
  if (el) {
    el.textContent = len + "/" + limit + " characters";
    el.classList.toggle("over", len > limit);
  }
}
document.getElementById("replyCode").addEventListener("input", updateReplyCount);
document.getElementById("replyText").addEventListener("input", updateReplyCount);
updateReplyCount();

document.getElementById("replySendBtn").onclick = async function () {
  const statusEl = document.getElementById("replyStatus");
  const setReplyStatus = (t) => {
    if (statusEl) statusEl.textContent = t;
  };

  try {
    if (!window.ethereum) {
      throw new Error("Connect a wallet (MetaMask) to send a reply");
    }

    const code = (document.getElementById("replyCode").value || "").trim();
    let text = (document.getElementById("replyText").value || "").trim();

    // Recipient: monitoring address from last CHECK, or lookup field, or default
    let toRaw = (
      monitoringAddress ||
      (document.getElementById("lookupAddress") || {}).value ||
      DEFAULT_ADDRESS
    ).toString().trim();

    // Resolve ENS if needed
    if (toRaw && !ethers.isAddress(toRaw)) {
      const resolved = await resolveEnsAddress(toRaw);
      if (!resolved) throw new Error("Invalid recipient address / ENS");
      toRaw = resolved;
    }
    if (!toRaw || !ethers.isAddress(toRaw)) {
      throw new Error("Load a ledger address with CHECK first");
    }
    if (!text) {
      throw new Error("Message required");
    }

    // Append conversation code when valid 8 hex chars
    if (/^[a-fA-F0-9]{8}$/.test(code)) {
      const withMark = text + " " + code.toLowerCase();
      if (utf8ByteLength(withMark) > MAX_METADATA_LENGTH) {
        let cut = text;
        while (
          utf8ByteLength(cut + " " + code.toLowerCase()) > MAX_METADATA_LENGTH &&
          cut.length > 0
        ) {
          cut = cut.slice(0, -1);
        }
        text = cut + " " + code.toLowerCase();
      } else {
        text = withMark;
      }
    } else if (utf8ByteLength(text) > MAX_METADATA_LENGTH) {
      throw new Error("Message exceeds 64 characters");
    }

    // Ensure wallet connected
    if (!signer || !userAddress) {
      await connectWallet(false);
    }
    if (!signer || !userAddress) {
      throw new Error("Wallet not connected");
    }

    const network = await provider.getNetwork();
    chainId = network.chainId;

    const domain = {
      name: "69069",
      version: "1",
      chainId: chainId,
      verifyingContract: CONTRACT_ADDRESS
    };

    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(text));
    const payloadHash = ethers.keccak256(
      ethers.toUtf8Bytes(
        "69069:" + userAddress + ":" + toRaw + ":" + Date.now()
      )
    );

    setReplyStatus("Sign in wallet…");
    const value = {
      signer: userAddress,
      intendedTo: toRaw,
      payloadHash,
      metadataHash
    };
    const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

    setReplyStatus("Submitting…");
    const writeContract =
      contract ||
      new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const tx = await writeContract.recordSignature(
      userAddress,
      toRaw,
      payloadHash,
      signature,
      text
    );

    setReplyStatus("Waiting for confirmation…");
    await tx.wait();
    setReplyStatus("Sent · " + tx.hash.slice(0, 10) + "…");
    setStatus("Sent 1 SOS OK", "connected");

    // Refresh feed for the same address
    await runCheck();
  } catch (err) {
    console.error("reply send", err);
    const msg =
      err?.reason || err?.shortMessage || err?.message || "Transaction failed";
    setReplyStatus(msg);
    setStatus(msg, "error");
  }
};

// ---------- Auto-connect on load ----------
window.addEventListener("load", () => {
  setTimeout(async () => {
    try {
      if (window.ethereum && !userPrefersDisconnected()) {
        setStatus("Connecting…", "info");
        const addr = await connectWallet(true);
        if (addr) {
          setConnectButtonText("DISCONNECT");
          document.getElementById("lookupAddress").value = DEFAULT_ADDRESS;
          await runCheck();
          return;
        }
      }
      setAddress("Read-only mode", "");
      setStatus("Read-only mode - connect to send", "info");
      setConnectButtonText("CONNECT");
      document.getElementById("lookupAddress").value = DEFAULT_ADDRESS;
      await runCheck();
    } catch (err) {
      console.warn("Auto-connect failed:", err);
      setAddress("Read-only mode", "");
      setStatus("Read-only mode - connect to send", "info");
      setConnectButtonText("CONNECT");
    }
  }, 500);
});