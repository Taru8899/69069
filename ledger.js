// ============================================================
//  CONTRACT  (SOS69069 / 69069 - EIP-712 signing)
// ============================================================
const CONTRACT_ADDRESS = "0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A";
const DEFAULT_ADDRESS = "0x1C10e6574ee696f54b21A611a21313E4714628ad";
const MAX_BATCH_SIZE = 200;
const MAX_METADATA_LENGTH = 64;

const ABI = [
  "function myStats() view returns (uint256 pushCount, uint256 trustCount, int256 effective)",
  "function effectiveOf(address) view returns (int256)",
  "function trustCountOf(address) view returns (uint256)",
  "function pushCountOf(address) view returns (uint256)",
  "function statsOf(address) view returns (uint256 pushCount, uint256 trustCount, int256 effective)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function brandText() view returns (string)",
  "function trustOverflowCountOf(address) view returns (uint256)",
  "function pushOverflowCountOf(address) view returns (uint256)",
  "function totalPhaseOverflowCount() view returns (uint256)",
  "function myEffective() view returns (int256)",
  "function myTrustCount() view returns (uint256)",
  "function myPushCount() view returns (uint256)",
  "function totalRecorded() view returns (uint256)",
  "function uint256Max() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function domainSeparator() view returns (bytes32)",
  "function recordStructHash(address signer, address intendedTo, bytes32 payloadHash, string metadata) pure returns (bytes32)",
  "function isRecordHashUsed(bytes32 structHash) view returns (bool)",
  "function myPushOverflowCount() view returns (uint256)",
  "function myTrustOverflowCount() view returns (uint256)",
  "function recordSignature(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)",
  "function recordSignatureOne(address signer, address intendedTo, bytes32[] payloadHashes, bytes[] signatures, string[] metadatas)"
];

const EIP712_TYPES = {
  Record: [
    { name: "signer", type: "address" },
    { name: "intendedTo", type: "address" },
    { name: "payloadHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" }
  ]
};

let provider, signer, contract, readContract, userAddress, chainId;

// ---------- ADVANCED panel toggle ----------
(function initAdvancedToggle() {
  try {
    const advancedToggle = document.getElementById("advancedToggle");
    const advancedPanel = document.getElementById("advancedPanel");
    if (!advancedToggle || !advancedPanel) return;

    advancedToggle.addEventListener("click", () => {
      const isHidden = advancedPanel.style.display === "none";
      advancedPanel.style.display = isHidden ? "block" : "none";
      advancedToggle.textContent = isHidden ? "ADVANCED (HIDE)" : "ADVANCED";
    });
  } catch (e) {
    console.error("Advanced toggle failed to initialize", e);
  }
})();

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

function setAddress(addr, method) {
  const el = document.getElementById("address");
  if (!el) return;
  let html = addr || "-";
  if (method === "extension") {
    html += ' <span class="method-badge badge-extension">&#128058; Extension</span>';
  } else if (method === "walletconnect") {
    html += ' <span class="method-badge badge-walletconnect">&#128241; Mobile</span>';
  } else if (method === "readonly") {
    html += ' <span class="method-badge badge-readonly">&#128065; Read-only</span>';
  }
  el.innerHTML = html;
}

function showReadOnlyAddress() {
  setAddress(DEFAULT_ADDRESS, "readonly");
}

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

function getReadContract() {
  if (contract) return contract;
  if (readContract) return readContract;
  try {
    const fallbackProvider = ethers.getDefaultProvider("homestead");
    readContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, fallbackProvider);
    return readContract;
  } catch (e) {
    console.warn("No read-only provider available:", e);
    return null;
  }
}

// ---------- Risk warning ----------
(function initRiskWarning() {
  try {
    const amountInput = document.getElementById("sendAmount");
    const riskWarning = document.getElementById("riskWarning");
    if (!amountInput || !riskWarning) return;

    function updateRiskWarning() {
      const val = parseInt(amountInput.value, 10) || 0;
      riskWarning.classList.toggle("visible", val > 50);
    }
    amountInput.addEventListener("input", updateRiskWarning);
    amountInput.addEventListener("change", updateRiskWarning);
  } catch (e) {
    console.error("Risk warning failed to initialize", e);
  }
})();

// ---------- Metadata char counter ----------
(function initMetaCounter() {
  try {
    const metadataInput = document.getElementById("metadata");
    const metaCount = document.getElementById("metaCount");
    if (!metadataInput || !metaCount) return;

    function updateMetaCount() {
      const convOn = document.getElementById("convStart")?.checked;
      const limit = convOn ? 56 : MAX_METADATA_LENGTH;
      const len = utf8ByteLength(metadataInput.value || "");
      metaCount.textContent = len + "/" + limit + " characters";
      metaCount.classList.toggle("over", len > limit);
    }
    metadataInput.addEventListener("input", updateMetaCount);
    updateMetaCount();
  } catch (e) {
    console.error("Metadata counter failed to initialize", e);
  }
})();

const convStartEl = document.getElementById("convStart");
const convCodeEl = document.getElementById("convCode");
if (convStartEl && convCodeEl) {
  convStartEl.addEventListener("change", () => {
    if (!convStartEl.checked) {
      convCodeEl.style.display = "none";
      convCodeEl.textContent = "";
    }
    const metadataInput = document.getElementById("metadata");
    if (metadataInput) metadataInput.dispatchEvent(new Event("input"));
  });
}

// ---------- Connect ----------
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

  setAddress(userAddress, "extension");
  setStatus("Connected", "connected");
  document.getElementById("connectButton").textContent = "CONNECTED";
  document.getElementById("sendBtn").disabled = false;
  clearDisconnectedFlag();

  await refreshStats();
  return userAddress;
}

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

function disconnectWallet() {
  signer = null;
  contract = null;
  userAddress = null;
  showReadOnlyAddress();
  setStatus("Disconnected", "warning");
  document.getElementById("connectButton").textContent = "CONNECT";
  markDisconnected();
  refreshStats();
}

document.getElementById("connectButton").onclick = async () => {
  if (userAddress) {
    disconnectWallet();
    return;
  }
  await connectWallet(false);
};

if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (accounts && accounts[0]) {
      await connectWallet(true);
    } else {
      signer = null;
      contract = null;
      userAddress = null;
      showReadOnlyAddress();
      setStatus("Wallet disconnected", "warning");
      document.getElementById("connectButton").textContent = "CONNECT";
      markDisconnected();
      await refreshStats();
    }
  });
  window.ethereum.on("chainChanged", () => {
    window.location.reload();
  });
}

// ---------- Stats ----------
async function refreshStats() {
  const addr = userAddress || DEFAULT_ADDRESS;
  const c = getReadContract();
  if (!c) return;
  try {
    const [push, trust, eff] = await c.statsOf(addr);
    document.getElementById("effective").textContent = eff.toString();
    document.getElementById("trust").textContent = trust.toString();
    document.getElementById("push").textContent = push.toString();
  } catch (e) {
    console.error("refreshStats", e);
  }
}

// ---------- Gas Cost (Push / Trust / Effective) - Etherscan API V2 ----------
(function initGasCost() {
  try {
    const btn = document.getElementById("calcGasBtn");
    const apiKeyInput = document.getElementById("etherscanApiKey");
    const statusEl = document.getElementById("gasStatus");
    const effectiveGasEl = document.getElementById("effectiveGas");
    const pushGasEl = document.getElementById("pushGas");
    const trustGasEl = document.getElementById("trustGas");
    const totalGasEl = document.getElementById("totalGas");
    const effectiveGasCountEl = document.getElementById("effectiveGasCount");
    const trustGasCountEl = document.getElementById("trustGasCount");
    const pushGasCountEl = document.getElementById("pushGasCount");
    const totalGasCountEl = document.getElementById("totalGasCount");
    const effectiveGasUsdEl = document.getElementById("effectiveGasUsd");
    const trustGasUsdEl = document.getElementById("trustGasUsd");
    const pushGasUsdEl = document.getElementById("pushGasUsd");
    const totalGasUsdEl = document.getElementById("totalGasUsd");
    if (!btn || !apiKeyInput || !statusEl || !pushGasEl || !trustGasEl || !effectiveGasEl || !totalGasEl) return;

    const API_KEY_STORAGE = "sos69069_etherscan_key";
    const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";
    const CHAIN_ID = 1;
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;

    // Force the new key as default
    const NEW_KEY = "V8YQ5ZVSVX6KNDVJBZG5TFG4TGVQN9ACGW";
    try {
      const saved = localStorage.getItem(API_KEY_STORAGE);
      if (saved) {
        apiKeyInput.value = saved;
      } else {
        apiKeyInput.value = NEW_KEY;
        localStorage.setItem(API_KEY_STORAGE, NEW_KEY);
      }
    } catch (_) {
      apiKeyInput.value = NEW_KEY;
    }

    function weiToEth(weiBigInt) {
      return ethers.formatEther(weiBigInt);
    }

    // ETH amount only — count and USD are now shown in their own spans
    // alongside each line, per the "• X ETH  • N txs (Y usd)" pattern.
    function formatEth(weiBigInt) {
      return weiToEth(weiBigInt) + " ETH";
    }

    function formatUsd(weiBigInt, ethUsdPrice) {
      if (!ethUsdPrice || ethUsdPrice <= 0) return "- usd";
      const ethStr = weiToEth(weiBigInt);
      const usd = (parseFloat(ethStr) * ethUsdPrice).toFixed(2);
      return usd + " usd";
    }

    async function safeJson(res) {
      const text = await res.text();
      if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
        return {
          status: "0",
          message: "Etherscan returned HTML error (invalid key / rate limit / temporary block). Create a new key at etherscan.io/myapikey",
          result: "HTML error page"
        };
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return {
          status: "0",
          message: text.slice(0, 120) || "Non-JSON response from API",
          result: text.slice(0, 120)
        };
      }
    }

    async function fetchEthUsd() {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
        const json = await safeJson(res);
        return json?.ethereum?.usd || null;
      } catch (_) {
        return null;
      }
    }

    async function fetchTxList(address) {
      let all = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          `${ETHERSCAN_BASE}?chainid=${CHAIN_ID}` +
          `&module=account&action=txlist` +
          `&address=${address}&startblock=0&endblock=99999999` +
          `&page=${page}&offset=${PAGE_SIZE}&sort=asc` +
          `&apikey=${encodeURIComponent(apiKeyInput.value.trim())}`;

        const res = await fetch(url);
        const json = await safeJson(res);

        if (json.status !== "1") {
          if (json.message && /no transactions found/i.test(json.message)) break;
          throw new Error(json.message || json.result || "Etherscan V2 request failed");
        }

        const batch = json.result || [];
        all = all.concat(batch);
        if (batch.length < PAGE_SIZE) break;

        await new Promise(r => setTimeout(r, 250));
      }
      return all;
    }

    btn.onclick = async () => {
      const apiKey = apiKeyInput.value.trim();
      if (!apiKey) {
        statusEl.textContent = "Enter an Etherscan API key first (free at etherscan.io/myapikey).";
        return;
      }
      try { localStorage.setItem(API_KEY_STORAGE, apiKey); } catch (_) {}

      const targetAddr = (userAddress || DEFAULT_ADDRESS).toLowerCase();
      const contractAddr = CONTRACT_ADDRESS.toLowerCase();

      const iface = getReadContract() ? getReadContract().interface : new ethers.Interface(ABI);
      const selPush1 = iface.getFunction("recordSignature").selector;
      const selPush2 = iface.getFunction("recordSignatureOne").selector;

      btn.disabled = true;
      effectiveGasEl.textContent = "-";
      pushGasEl.textContent = "-";
      trustGasEl.textContent = "-";
      totalGasEl.textContent = "-";
      for (const el of [effectiveGasCountEl, trustGasCountEl, pushGasCountEl, totalGasCountEl,
                         effectiveGasUsdEl, trustGasUsdEl, pushGasUsdEl, totalGasUsdEl]) {
        if (el) el.textContent = "-";
      }

      try {
        statusEl.textContent = "Fetching ETH price...";
        const ethUsd = await fetchEthUsd();

        statusEl.textContent = "Reading effective count...";
        let effectiveN = 0;
        try {
          const c = getReadContract();
          if (c) {
            const [, , eff] = await c.statsOf(targetAddr);
            effectiveN = Math.max(0, Number(eff.toString()));
          }
        } catch (_) {}

        // ---- Push gas ----
        statusEl.textContent = "Fetching this address's transactions...";
        const ownTxs = await fetchTxList(targetAddr);

        let pushFeeWei = 0n;
        let pushTxCount = 0;
        for (const tx of ownTxs) {
          if ((tx.to || "").toLowerCase() !== contractAddr) continue;
          if (tx.isError !== "0") continue;
          const methodId = (tx.methodId || (tx.input || "").slice(0, 10)).toLowerCase();
          if (methodId !== selPush1.toLowerCase() && methodId !== selPush2.toLowerCase()) continue;
          pushFeeWei += BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
          pushTxCount++;
        }
        pushGasEl.textContent = formatEth(pushFeeWei);
        if (pushGasCountEl) pushGasCountEl.textContent = `${pushTxCount} push tx${pushTxCount === 1 ? "" : "s"} gas cost`;
        if (pushGasUsdEl) pushGasUsdEl.textContent = formatUsd(pushFeeWei, ethUsd);

        // ---- Trust + Effective ----
        statusEl.textContent = "Fetching all contract transactions (this can take a moment)...";
        const contractTxs = await fetchTxList(contractAddr);

        const trustEntries = [];
        statusEl.textContent = `Decoding ${contractTxs.length} contract transactions...`;
        for (const tx of contractTxs) {
          if (tx.isError !== "0") continue;
          const methodId = (tx.methodId || (tx.input || "").slice(0, 10)).toLowerCase();
          if (methodId !== selPush1.toLowerCase() && methodId !== selPush2.toLowerCase()) continue;

          let intendedTo;
          try {
            const parsed = iface.parseTransaction({ data: tx.input });
            intendedTo = (parsed.args.intendedTo || parsed.args[1] || "").toLowerCase();
          } catch (_) {
            continue;
          }
          if (intendedTo !== targetAddr) continue;

          const fee = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
          trustEntries.push({
            fee,
            block: parseInt(tx.blockNumber || "0", 10)
          });
        }

        let trustFeeWei = 0n;
        for (const e of trustEntries) trustFeeWei += e.fee;
        trustGasEl.textContent = formatEth(trustFeeWei);
        if (trustGasCountEl) trustGasCountEl.textContent = `${trustEntries.length} trust tx${trustEntries.length === 1 ? "" : "s"} gas cost`;
        if (trustGasUsdEl) trustGasUsdEl.textContent = formatUsd(trustFeeWei, ethUsd);

        // Effective Gas = sum of the most recent N trust transactions
        trustEntries.sort((a, b) => b.block - a.block);
        const n = Math.min(effectiveN, trustEntries.length);
        let effectiveFeeWei = 0n;
        for (let i = 0; i < n; i++) {
          effectiveFeeWei += trustEntries[i].fee;
        }
        effectiveGasEl.textContent = formatEth(effectiveFeeWei);
        if (effectiveGasCountEl) effectiveGasCountEl.textContent = `${n} effective tx${n === 1 ? "" : "s"} gas cost`;
        if (effectiveGasUsdEl) effectiveGasUsdEl.textContent = formatUsd(effectiveFeeWei, ethUsd);

        // Total Gas = Push + Trust. Effective is deliberately excluded here:
        // it's the fee of the most recent N Trust transactions (N = effective
        // count), so it's already a subset of trustFeeWei, not an addition
        // to it — including it too would double-count those transactions.
        const totalFeeWei = pushFeeWei + trustFeeWei;
        const totalTxCount = trustEntries.length + pushTxCount;
        totalGasEl.textContent = formatEth(totalFeeWei);
        if (totalGasCountEl) totalGasCountEl.textContent = `${totalTxCount} total tx${totalTxCount === 1 ? "" : "s"} gas cost`;
        if (totalGasUsdEl) totalGasUsdEl.textContent = formatUsd(totalFeeWei, ethUsd);

        statusEl.textContent = "Done.";
      } catch (err) {
        console.error("gas cost calc error", err);
        statusEl.textContent = err?.message || "Failed to fetch gas costs.";
      } finally {
        btn.disabled = false;
      }
    };
  } catch (e) {
    console.error("Gas cost panel failed to initialize", e);
  }
})();

// ---------- SEND ----------
document.getElementById("sendBtn").onclick = async () => {
  if (!signer || !contract) {
    setStatus("Connect wallet first", "error");
    return;
  }

  const to = document.getElementById("receiver").value.trim();
  const amount = parseInt(document.getElementById("sendAmount").value, 10);
  const metadata = document.getElementById("metadata").value || "";

  if (!ethers.isAddress(to)) {
    setStatus("Invalid recipient address", "error");
    return;
  }
  if (!amount || amount < 1) {
    setStatus("Amount must be at least 1", "error");
    return;
  }
  if (amount > MAX_BATCH_SIZE) {
    setStatus("Amount exceeds max batch size (" + MAX_BATCH_SIZE + ")", "error");
    return;
  }
  const convOn = document.getElementById("convStart")?.checked;
  const metaLimit = convOn ? 56 : MAX_METADATA_LENGTH;
  if (utf8ByteLength(metadata) > metaLimit) {
    setStatus("Metadata exceeds " + metaLimit + " characters", "error");
    return;
  }
  if (amount > 50) {
    const ok = confirm(
      "You are about to send " + amount + " SOS.\n\n" +
      "This requires " + amount + " wallet signatures (max " + MAX_BATCH_SIZE + " per batch) " +
      "and will consume more gas.\nContinue at your own risk?"
    );
    if (!ok) return;
  }

  const btn = document.getElementById("sendBtn");
  btn.disabled = true;
  const progress = document.getElementById("signProgress");
  const bar = document.getElementById("signBar");
  const step = document.getElementById("signStep");
  const mintProgress = document.getElementById("mintProgress");

  progress.style.display = "block";
  step.style.display = "block";

  try {
    const network = await provider.getNetwork();
    chainId = network.chainId;

    const domain = {
      name: "69069",
      version: "1",
      chainId: chainId,
      verifyingContract: CONTRACT_ADDRESS
    };

    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));

    if (amount === 1) {
      step.textContent = "Sign in wallet...";
      bar.style.width = "40%";

      const payloadHash = ethers.keccak256(
        ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now())
      );

      const value = { signer: userAddress, intendedTo: to, payloadHash, metadataHash };
      const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

      bar.style.width = "100%";
      step.textContent = "Submitting transaction...";
      mintProgress.textContent = "Waiting for confirmation...";

      const tx = await contract.recordSignature(userAddress, to, payloadHash, signature, metadata);

      setStatus("Tx sent - waiting...", "info");
      await tx.wait();
      setStatus("Sent 1 SOS OK", "connected");
      mintProgress.textContent = "Confirmed - " + tx.hash.slice(0, 10) + "...";
      if (convStartEl && convStartEl.checked && convCodeEl) {
        const marker = tx.hash.slice(2, 10);
        convCodeEl.style.display = "block";
        convCodeEl.textContent = "Conversation code: " + marker;
      }
    } else {
      const payloadHashes = [];
      const signatures = [];
      const metadatas = [];

      for (let i = 0; i < amount; i++) {
        step.textContent = "Sign " + (i + 1) + " of " + amount + "...";
        bar.style.width = Math.round(((i + 1) / amount) * 90) + "%";
        mintProgress.textContent = "Signature " + (i + 1) + " / " + amount;

        const payloadHash = ethers.keccak256(
          ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now() + ":" + i)
        );
        const value = { signer: userAddress, intendedTo: to, payloadHash, metadataHash };
        const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

        payloadHashes.push(payloadHash);
        signatures.push(signature);
        metadatas.push(metadata);
      }

      bar.style.width = "100%";
      step.textContent = "Submitting transaction...";
      mintProgress.textContent = "Waiting for confirmation...";

      const tx = await contract.recordSignatureOne(userAddress, to, payloadHashes, signatures, metadatas);

      setStatus("Tx sent - waiting...", "info");
      await tx.wait();
      setStatus("Sent " + amount + " SOS OK", "connected");
      mintProgress.textContent = "Confirmed - " + tx.hash.slice(0, 10) + "...";
    }
  } catch (err) {
    console.error("send error", err);
    setStatus(err?.reason || err?.shortMessage || err?.message || "Transaction failed", "error");
    mintProgress.textContent = "";
  } finally {
    btn.disabled = false;
    progress.style.display = "none";
    step.style.display = "none";
    bar.style.width = "0%";
    await refreshStats();
  }
};

// ============================================================
//  ADVANCED
// ============================================================
const advMetadataList = document.getElementById("advMetadataList");
const advLinesInfo = document.getElementById("advLinesInfo");
const advSendBtn = document.getElementById("advSendBtn");

function getAdvMessages() {
  return advMetadataList.value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

const advConvStart = document.getElementById("advConvStart");
const advConvCode = document.getElementById("advConvCode");

advConvStart.addEventListener("change", () => {
  if (!advConvStart.checked) {
    advConvCode.style.display = "none";
    advConvCode.textContent = "";
  }
  advMetadataList.placeholder = advConvStart.checked
    ? "up to 56 characters (max 200 lines)"
    : "up to 64 characters (max 200 lines)";
  updateAdvLinesInfo();
});

function updateAdvLinesInfo() {
  const messages = getAdvMessages();
  const conv = advConvStart.checked;
  const maxLen = conv ? 56 : MAX_METADATA_LENGTH;
  const tooLong = messages.filter((m, i) => {
    if (conv && i === 0) return utf8ByteLength(m) > MAX_METADATA_LENGTH;
    return utf8ByteLength(m) > maxLen;
  }).length;
  const tooMany = messages.length > MAX_BATCH_SIZE;

  let maxLineLen = 0;
  for (const m of messages) {
    const n = utf8ByteLength(m);
    if (n > maxLineLen) maxLineLen = n;
  }
  if (messages.length === 0) maxLineLen = 0;

  let text = maxLineLen + "/" + maxLen + " characters · " +
    messages.length + " message" + (messages.length === 1 ? "" : "s") + " queued";
  let over = false;

  if (tooLong > 0) {
    text += " - " + tooLong + " line" + (tooLong === 1 ? "" : "s") + " over " + (conv ? "limit (56 after first)" : "64 characters");
    over = true;
  }
  if (tooMany) {
    text += " - max " + MAX_BATCH_SIZE + " per batch";
    over = true;
  }

  advLinesInfo.textContent = text;
  advLinesInfo.classList.toggle("over", over);
}
advMetadataList.addEventListener("input", updateAdvLinesInfo);
updateAdvLinesInfo();

document.getElementById("advSendBtn").onclick = async () => {
  if (!signer || !contract) {
    setStatus("Connect wallet first", "error");
    return;
  }

  const to = document.getElementById("advReceiver").value.trim();
  let messages = getAdvMessages();
  const convStart = document.getElementById("advConvStart").checked;

  if (!ethers.isAddress(to)) {
    setStatus("Invalid recipient address", "error");
    return;
  }
  if (messages.length === 0) {
    setStatus("Add at least one message", "error");
    return;
  }
  if (messages.length > MAX_BATCH_SIZE) {
    setStatus("Too many messages (max " + MAX_BATCH_SIZE + ")", "error");
    return;
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const limit = (convStart && i > 0) ? 56 : MAX_METADATA_LENGTH;
    if (utf8ByteLength(m) > limit) {
      setStatus(
        (convStart && i > 0)
          ? "Line " + (i + 1) + " exceeds 56 characters (space reserved for conversation code)"
          : "A message exceeds " + MAX_METADATA_LENGTH + " characters",
        "error"
      );
      return;
    }
  }

  if (messages.length > 50) {
    const ok = confirm(
      "You are about to send " + messages.length + " messages.\n\n" +
      "This requires " + messages.length + " wallet signatures (max " + MAX_BATCH_SIZE + " per batch) " +
      "and will consume more gas.\nContinue at your own risk?"
    );
    if (!ok) return;
  }

  const btn = document.getElementById("advSendBtn");
  btn.disabled = true;
  const progress = document.getElementById("advSignProgress");
  const bar = document.getElementById("advSignBar");
  const step = document.getElementById("advSignStep");
  const mintProgress = document.getElementById("advMintProgress");

  progress.style.display = "block";
  step.style.display = "block";

  try {
    const network = await provider.getNetwork();
    chainId = network.chainId;

    const domain = {
      name: "69069",
      version: "1",
      chainId: chainId,
      verifyingContract: CONTRACT_ADDRESS
    };

    if (convStart && messages.length >= 1) {
      const first = messages[0];
      const rest = messages.slice(1);

      step.textContent = "Sign first message (conversation start)...";
      bar.style.width = "20%";
      mintProgress.textContent = "Signature 1 / " + messages.length;

      const payloadHash1 = ethers.keccak256(
        ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now() + ":0")
      );
      const metadataHash1 = ethers.keccak256(ethers.toUtf8Bytes(first));
      const value1 = { signer: userAddress, intendedTo: to, payloadHash: payloadHash1, metadataHash: metadataHash1 };
      const signature1 = await signer.signTypedData(domain, EIP712_TYPES, value1);

      step.textContent = "Submitting first message...";
      bar.style.width = "35%";
      mintProgress.textContent = "Waiting for confirmation (root)...";

      const tx1 = await contract.recordSignature(userAddress, to, payloadHash1, signature1, first);
      setStatus("Tx sent - waiting for root...", "info");
      await tx1.wait();

      const marker = tx1.hash.slice(2, 10);
      if (advConvCode) {
        advConvCode.style.display = "block";
        advConvCode.textContent = "Conversation code: " + marker + "  (appended to following messages)";
      }
      setStatus("Root recorded · code " + marker, "connected");

      if (rest.length === 0) {
        bar.style.width = "100%";
        step.textContent = "Done";
        mintProgress.textContent = "Confirmed - " + tx1.hash.slice(0, 10) + "...";
        setStatus("Sent 1 message OK (conversation start)", "connected");
      } else {
        const tagged = rest.map(line => {
          const base = line.trim();
          const withMark = base + " " + marker;
          if (utf8ByteLength(withMark) > MAX_METADATA_LENGTH) {
            let cut = base;
            while (utf8ByteLength(cut + " " + marker) > MAX_METADATA_LENGTH && cut.length > 0) {
              cut = cut.slice(0, -1);
            }
            return cut + " " + marker;
          }
          return withMark;
        });

        const payloadHashes = [];
        const signatures = [];
        const metadatas = [];

        for (let i = 0; i < tagged.length; i++) {
          const metadata = tagged[i];
          const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));

          step.textContent = "Sign " + (i + 2) + " of " + messages.length + "...";
          bar.style.width = Math.round(35 + ((i + 1) / tagged.length) * 55) + "%";
          mintProgress.textContent = "Signature " + (i + 2) + " / " + messages.length;

          const payloadHash = ethers.keccak256(
            ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now() + ":" + (i + 1))
          );
          const value = { signer: userAddress, intendedTo: to, payloadHash, metadataHash };
          const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

          payloadHashes.push(payloadHash);
          signatures.push(signature);
          metadatas.push(metadata);
        }

        bar.style.width = "95%";
        step.textContent = "Submitting remaining messages...";
        mintProgress.textContent = "Waiting for confirmation...";

        let tx2;
        if (tagged.length === 1) {
          tx2 = await contract.recordSignature(userAddress, to, payloadHashes[0], signatures[0], metadatas[0]);
        } else {
          tx2 = await contract.recordSignatureOne(userAddress, to, payloadHashes, signatures, metadatas);
        }
        setStatus("Tx sent - waiting...", "info");
        await tx2.wait();
        bar.style.width = "100%";
        setStatus("Sent " + messages.length + " messages OK · code " + marker, "connected");
        mintProgress.textContent = "Confirmed - " + tx2.hash.slice(0, 10) + "...";
      }

    } else if (messages.length === 1) {
      const metadata = messages[0];
      const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));

      step.textContent = "Sign in wallet...";
      bar.style.width = "40%";

      const payloadHash = ethers.keccak256(
        ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now())
      );

      const value = { signer: userAddress, intendedTo: to, payloadHash, metadataHash };
      const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

      bar.style.width = "100%";
      step.textContent = "Submitting transaction...";
      mintProgress.textContent = "Waiting for confirmation...";

      const tx = await contract.recordSignature(userAddress, to, payloadHash, signature, metadata);

      setStatus("Tx sent - waiting...", "info");
      await tx.wait();
      setStatus("Sent 1 message OK", "connected");
      mintProgress.textContent = "Confirmed - " + tx.hash.slice(0, 10) + "...";
    } else {
      const payloadHashes = [];
      const signatures = [];
      const metadatas = [];

      for (let i = 0; i < messages.length; i++) {
        const metadata = messages[i];
        const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));

        step.textContent = "Sign " + (i + 1) + " of " + messages.length + "...";
        bar.style.width = Math.round(((i + 1) / messages.length) * 90) + "%";
        mintProgress.textContent = "Signature " + (i + 1) + " / " + messages.length;

        const payloadHash = ethers.keccak256(
          ethers.toUtf8Bytes("69069:" + userAddress + ":" + to + ":" + Date.now() + ":" + i)
        );
        const value = { signer: userAddress, intendedTo: to, payloadHash, metadataHash };
        const signature = await signer.signTypedData(domain, EIP712_TYPES, value);

        payloadHashes.push(payloadHash);
        signatures.push(signature);
        metadatas.push(metadata);
      }

      bar.style.width = "100%";
      step.textContent = "Submitting transaction...";
      mintProgress.textContent = "Waiting for confirmation...";

      const tx = await contract.recordSignatureOne(userAddress, to, payloadHashes, signatures, metadatas);

      setStatus("Tx sent - waiting...", "info");
      await tx.wait();
      setStatus("Sent " + messages.length + " messages OK", "connected");
      mintProgress.textContent = "Confirmed - " + tx.hash.slice(0, 10) + "...";
    }
  } catch (err) {
    console.error("advanced send error", err);
    setStatus(err?.reason || err?.shortMessage || err?.message || "Transaction failed", "error");
    mintProgress.textContent = "";
  } finally {
    btn.disabled = false;
    progress.style.display = "none";
    step.style.display = "none";
    bar.style.width = "0%";
    await refreshStats();
    updateAdvLinesInfo();
  }
};

// ---------- Auto-connect on load ----------
window.addEventListener("load", () => {
  setTimeout(async () => {
    try {
      if (window.ethereum && !userPrefersDisconnected()) {
        setStatus("Connecting...", "info");
        const addr = await connectWallet(true);
        if (addr) return;
      }

      showReadOnlyAddress();
      setStatus("Read-only mode - connect ledger to send", "info");
      await refreshStats();
    } catch (err) {
      console.warn("Auto-connect failed:", err);
      showReadOnlyAddress();
      setStatus("Read-only mode - connect ledger to send", "info");
      await refreshStats();
    }
  }, 600);
});