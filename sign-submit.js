// ============================================================
//  69069 — SIGN & SUBMIT (split flow)
//  Sign with one wallet (free, off-chain).
//  Submit with another (pays gas, on-chain).
// ============================================================

const CONTRACT_ADDRESS = "0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A";
const MAX_METADATA_LENGTH = 64;

const ABI = [
  "function recordSignature(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)",
  "function recordSignatureOne(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)",
  "error DuplicatePayloadHash()",
  "error InvalidSigner()",
  "error MetadataTooLong()",
  "error ZeroAddress()"
];

const EIP712_TYPES = {
  Record: [
    { name: "signer",       type: "address" },
    { name: "intendedTo",   type: "address" },
    { name: "payloadHash",  type: "bytes32" },
    { name: "metadataHash", type: "bytes32" }
  ]
};

// ============================================================
// HELPERS
// ============================================================

function short(a) {
  return a ? a.slice(0, 6) + "..." + a.slice(-4) : "";
}

function setStatus(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerText = text;
  el.className = "hint";
  if (type === "connected") el.classList.add("status-connected");
  else if (type === "error")   el.classList.add("status-error");
  else if (type === "warning") el.classList.add("status-warning");
  else if (type === "info")    el.classList.add("status-info");
}

function setBadgeText(elId, addr, method) {
  const el = document.getElementById(elId);
  if (!el) return;
  let html = short(addr);
  if (method === "extension") {
    html += ' <span class="method-badge badge-extension">&#128058; Extension</span>';
  } else if (method === "walletconnect") {
    html += ' <span class="method-badge badge-walletconnect">&#128241; Mobile</span>';
  }
  el.innerHTML = html;
}

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

// ============================================================
// STEP TABS
// ============================================================

const tabSignBtn   = document.getElementById("tabSignBtn");
const tabSubmitBtn = document.getElementById("tabSubmitBtn");
const signPanel    = document.getElementById("signPanel");
const submitPanel  = document.getElementById("submitPanel");

tabSignBtn.onclick = () => {
  tabSignBtn.classList.add("active");   tabSubmitBtn.classList.remove("active");
  signPanel.classList.add("active");    submitPanel.classList.remove("active");
};
tabSubmitBtn.onclick = () => {
  tabSubmitBtn.classList.add("active"); tabSignBtn.classList.remove("active");
  submitPanel.classList.add("active");  signPanel.classList.remove("active");
};

// ============================================================
// SIGN PANEL — off-chain only, never sends a transaction
// ============================================================

let signProvider, signSigner, signAddress, signChainId;

const metadataInput = document.getElementById("metadata");
const metaCount     = document.getElementById("metaCount");

metadataInput.addEventListener("input", () => {
  const len = utf8ByteLength(metadataInput.value);
  metaCount.textContent = `${len}/${MAX_METADATA_LENGTH} characters`;
  metaCount.classList.toggle("over", len > MAX_METADATA_LENGTH);
});

document.getElementById("connectSignBtn").onclick = async () => {
  if (!window.ethereum) {
    setStatus("signWalletStatus", "No wallet found - install MetaMask", "error");
    return;
  }
  try {
    signProvider = new ethers.BrowserProvider(window.ethereum);
    await signProvider.send("eth_requestAccounts", []);
    signSigner  = await signProvider.getSigner();
    signAddress = await signSigner.getAddress();
    const net   = await signProvider.getNetwork();
    signChainId = net.chainId;

    setBadgeText("signWalletStatus", signAddress, "extension");
    document.getElementById("connectSignBtn").textContent = "CONNECTED";
    document.getElementById("signBtn").disabled = false;
  } catch (e) {
    setStatus("signWalletStatus", e.shortMessage || e.message || "Connection failed", "error");
  }
};

document.getElementById("signBtn").onclick = async () => {
  const intendedTo   = document.getElementById("intendedTo").value.trim();
  const metadata     = metadataInput.value.trim();
  const signProgress = document.getElementById("signProgress");
  const signBar      = document.getElementById("signBar");

  if (!ethers.isAddress(intendedTo)) {
    setStatus("signStatus", "Enter a valid intendedTo address", "error");
    return;
  }
  if (metadata.length === 0) {
    setStatus("signStatus", "Metadata cannot be empty", "error");
    return;
  }
  if (utf8ByteLength(metadata) > MAX_METADATA_LENGTH) {
    setStatus("signStatus", "Metadata exceeds 64 bytes", "error");
    return;
  }

  try {
    signProgress.classList.add("visible");
    signBar.style.width = "30%";

    // payloadHash: unique random bytes32 per message — this is what
    // the contract stores as the primary unique key for this record.
    // It is independent of metadata; metadata is a human-readable label.
    const payloadHash  = ethers.hexlify(ethers.randomBytes(32));

    // metadataHash: keccak256 of the metadata string —
    // the contract recomputes this itself from the metadata param.
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadata));

    const domain = {
      name: "69069", version: "1",
      chainId: signChainId, verifyingContract: CONTRACT_ADDRESS
    };
    const value = { signer: signAddress, intendedTo, payloadHash, metadataHash };

    signBar.style.width = "60%";
    setStatus("signStatus", "Waiting for signature in wallet...", "info");

    const signature = await signSigner.signTypedData(domain, EIP712_TYPES, value);
    signBar.style.width = "100%";

    const payload = {
      signer: signAddress,
      intendedTo,
      payloadHash,
      metadata,
      signature,
      chainId:  signChainId.toString(),
      contract: CONTRACT_ADDRESS
    };

    const out = document.getElementById("signOutput");
    out.style.display = "block";
    out.textContent   = JSON.stringify(payload, null, 2);

    const copyBtn = document.getElementById("copyBtn");
    copyBtn.style.display   = "block";
    copyBtn.dataset.payload = JSON.stringify(payload);

    setStatus("signStatus", "Signed — no transaction was sent. Copy the payload above.", "connected");
  } catch (e) {
    setStatus("signStatus", e.shortMessage || e.message || "Signing failed / rejected", "error");
  } finally {
    setTimeout(() => {
      signProgress.classList.remove("visible");
      signBar.style.width = "0%";
    }, 600);
  }
};

document.getElementById("copyBtn").onclick = async (e) => {
  try {
    await navigator.clipboard.writeText(e.target.dataset.payload);
    setStatus("signStatus", "Copied to clipboard", "connected");
  } catch {
    setStatus("signStatus", "Copy failed — select and copy manually", "error");
  }
};

// ============================================================
// SUBMIT PANEL — paste JSON, submit on-chain with burner wallet
// ============================================================

let submitProvider, submitSigner, submitAddress, parsedPayload;

document.getElementById("connectSubmitBtn").onclick = async () => {
  if (!window.ethereum) {
    setStatus("submitWalletStatus", "No wallet found - install MetaMask", "error");
    return;
  }
  try {
    submitProvider = new ethers.BrowserProvider(window.ethereum);
    await submitProvider.send("eth_requestAccounts", []);
    submitSigner  = await submitProvider.getSigner();
    submitAddress = await submitSigner.getAddress();

    setBadgeText("submitWalletStatus", submitAddress, "extension");
    document.getElementById("connectSubmitBtn").textContent = "CONNECTED";
    document.getElementById("submitBtn").disabled = !parsedPayload;
  } catch (e) {
    setStatus("submitWalletStatus", e.shortMessage || e.message || "Connection failed", "error");
  }
};

document.getElementById("parseBtn").onclick = () => {
  try {
    const raw     = document.getElementById("pastePayload").value.trim();
    parsedPayload = JSON.parse(raw);

    const required = ["signer", "intendedTo", "payloadHash", "signature", "metadata"];
    for (const key of required) {
      if (!(key in parsedPayload)) throw new Error(`Missing field: ${key}`);
    }
    if (!ethers.isAddress(parsedPayload.signer) || !ethers.isAddress(parsedPayload.intendedTo)) {
      throw new Error("Invalid address in payload");
    }

    const preview = document.getElementById("parsedPreview");
    preview.style.display = "block";
    preview.textContent   =
      `signer:      ${parsedPayload.signer}\n` +
      `intendedTo:  ${parsedPayload.intendedTo}\n` +
      `metadata:    ${parsedPayload.metadata}\n` +
      `payloadHash: ${parsedPayload.payloadHash}\n` +
      `signature:   ${parsedPayload.signature.slice(0, 20)}...`;

    document.getElementById("submitBtn").disabled = !submitSigner;
    setStatus("submitStatus", "Payload loaded — ready to submit", "connected");
  } catch (e) {
    parsedPayload = null;
    document.getElementById("submitBtn").disabled = true;
    setStatus("submitStatus", "Invalid payload: " + e.message, "error");
  }
};

document.getElementById("submitBtn").onclick = async () => {
  const submitProgress = document.getElementById("submitProgress");
  const submitBar      = document.getElementById("submitBar");

  if (!submitSigner) {
    setStatus("submitStatus", "Connect a submitting wallet first", "error");
    return;
  }
  if (!parsedPayload) {
    setStatus("submitStatus", "Load a payload first", "error");
    return;
  }

  try {
    submitProgress.classList.add("visible");
    submitBar.style.width = "30%";

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, submitSigner);
    setStatus("submitStatus", "Confirm the transaction in your wallet...", "info");
    submitBar.style.width = "60%";

    const tx = await contract.recordSignature(
      parsedPayload.signer,
      parsedPayload.intendedTo,
      parsedPayload.payloadHash,
      parsedPayload.signature,
      parsedPayload.metadata
    );

    setStatus("submitStatus", `Submitted: ${short(tx.hash)} — waiting for confirmation...`, "info");
    await tx.wait();
    submitBar.style.width = "100%";
    setStatus("submitStatus", `Confirmed on-chain: ${short(tx.hash)}`, "connected");
  } catch (e) {
    // With custom errors in ABI, e.revert.name now shows the real error
    const reason = e.revert?.name || e.shortMessage || e.message || "Transaction failed";
    setStatus("submitStatus", reason, "error");
  } finally {
    setTimeout(() => {
      submitProgress.classList.remove("visible");
      submitBar.style.width = "0%";
    }, 600);
  }
};

// ============================================================
// ============================================================
// BATCH SECTION — NEW FUNCTIONALITY
// Paste addresses line by line + messages line by line.
// All variables and element IDs prefixed b_ to avoid conflicts.
// ============================================================
// ============================================================

let b_pairs = [];
let b_signProvider, b_signSigner, b_signAddress, b_signChainId;
let b_submitProvider, b_submitSigner, b_submitAddress;

// ---------- helpers ----------

function b_parseLines(text) {
  return text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
}

function b_setStatus(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerText = text;
  el.className = "hint";
  if (type === "connected") el.classList.add("status-connected");
  else if (type === "error")   el.classList.add("status-error");
  else if (type === "warning") el.classList.add("status-warning");
  else if (type === "info")    el.classList.add("status-info");
}

function b_setBadge(elId, addr) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = short(addr) +
    ' <span class="method-badge badge-extension">&#128058; Extension</span>';
}

// ---------- live line counters ----------

document.getElementById("b_addrInput").addEventListener("input", () => {
  const n = b_parseLines(document.getElementById("b_addrInput").value).length;
  document.getElementById("b_addrCount").textContent = `${n} line${n !== 1 ? "s" : ""}`;
  b_syncMismatch();
});

document.getElementById("b_msgInput").addEventListener("input", () => {
  const n = b_parseLines(document.getElementById("b_msgInput").value).length;
  document.getElementById("b_msgCount").textContent = `${n} line${n !== 1 ? "s" : ""}`;
  b_syncMismatch();
});

function b_syncMismatch() {
  const a = b_parseLines(document.getElementById("b_addrInput").value).length;
  const m = b_parseLines(document.getElementById("b_msgInput").value).length;
  const bad = a > 0 && m > 0 && a !== m;
  document.getElementById("b_addrCount").classList.toggle("mismatch", bad);
  document.getElementById("b_msgCount").classList.toggle("mismatch",  bad);
}

// ---------- load pairs ----------

document.getElementById("b_loadBtn").onclick = () => {
  const addrLines = b_parseLines(document.getElementById("b_addrInput").value);
  const msgLines  = b_parseLines(document.getElementById("b_msgInput").value);

  if (addrLines.length === 0) { b_setStatus("b_loadStatus", "Paste at least one address", "error"); return; }
  if (msgLines.length  === 0) { b_setStatus("b_loadStatus", "Paste at least one message", "error"); return; }
  if (addrLines.length !== msgLines.length) {
    b_setStatus("b_loadStatus",
      `Line count mismatch — ${addrLines.length} addresses vs ${msgLines.length} messages`, "error");
    return;
  }

  const errors = [];
  addrLines.forEach((addr, i) => {
    if (!ethers.isAddress(addr)) errors.push(`Line ${i + 1}: invalid address "${addr}"`);
  });
  msgLines.forEach((msg, i) => {
    if (msg.length === 0) errors.push(`Line ${i + 1}: message is empty`);
    if (utf8ByteLength(msg) > MAX_METADATA_LENGTH) errors.push(`Line ${i + 1}: message exceeds 64 bytes`);
  });
  if (errors.length > 0) { b_setStatus("b_loadStatus", errors[0], "error"); return; }

  b_pairs = addrLines.map((addr, i) => ({
    intendedTo:  addr,
    metadata:    msgLines[i],
    payloadHash: null,
    signature:   null,
    status:      "pending",
    txHash:      null,
    error:       null
  }));

  b_renderPairs();
  document.getElementById("b_previewCard").style.display = "block";
  b_setStatus("b_loadStatus",
    `${b_pairs.length} pair${b_pairs.length !== 1 ? "s" : ""} loaded — ready to sign`, "connected");
  document.getElementById("b_signAllBtn").disabled = !b_signSigner;
};

// ---------- render pairs ----------

function b_renderPairs() {
  document.getElementById("b_pairList").innerHTML = b_pairs.map((p, i) => `
    <div class="b-pair-row">
      <span class="b-pair-num">${i + 1}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="b-pair-addr">${short(p.intendedTo)}</span>
          <span class="b-pair-arrow">→</span>
          <span class="b-pair-meta">${p.metadata}</span>
          <span class="b-pair-status ${p.status}">${p.status.toUpperCase()}</span>
        </div>
        ${p.error  ? `<div class="b-pair-error">${p.error}</div>` : ""}
        ${p.txHash ? `<div class="b-pair-tx">tx: ${short(p.txHash)}</div>` : ""}
      </div>
    </div>
  `).join("");

  b_updateSummary();
}

function b_updateSummary() {
  const total     = b_pairs.length;
  const signed    = b_pairs.filter(p => p.status === "signed"    || p.status === "confirmed").length;
  const confirmed = b_pairs.filter(p => p.status === "confirmed").length;
  const errors    = b_pairs.filter(p => p.status === "error").length;
  if (total === 0) { document.getElementById("b_summary").innerHTML = ""; return; }
  document.getElementById("b_summary").innerHTML = `
    <span class="b-summary-item">Total <span>${total}</span></span>
    <span class="b-summary-item ${signed > 0 ? "ok" : ""}">Signed <span>${signed}</span></span>
    <span class="b-summary-item ${confirmed > 0 ? "ok" : ""}">Confirmed <span>${confirmed}</span></span>
    ${errors > 0 ? `<span class="b-summary-item err">Errors <span>${errors}</span></span>` : ""}
  `;
}

// ---------- connect batch signing wallet ----------

document.getElementById("b_connectSignBtn").onclick = async () => {
  if (!window.ethereum) { b_setStatus("b_signWalletStatus", "No wallet found - install MetaMask", "error"); return; }
  try {
    b_signProvider = new ethers.BrowserProvider(window.ethereum);
    await b_signProvider.send("eth_requestAccounts", []);
    b_signSigner  = await b_signProvider.getSigner();
    b_signAddress = await b_signSigner.getAddress();
    const net     = await b_signProvider.getNetwork();
    b_signChainId = net.chainId;

    b_setBadge("b_signWalletStatus", b_signAddress);
    document.getElementById("b_connectSignBtn").textContent = "CONNECTED";
    document.getElementById("b_signAllBtn").disabled = b_pairs.length === 0;
  } catch (e) {
    b_setStatus("b_signWalletStatus", e.shortMessage || e.message || "Connection failed", "error");
  }
};

// ---------- sign all ----------

document.getElementById("b_signAllBtn").onclick = async () => {
  const pending = b_pairs.filter(p => p.status === "pending");
  if (pending.length === 0) { b_setStatus("b_signStatus", "No pending pairs to sign", "warning"); return; }

  const prog = document.getElementById("b_signProgress");
  const bar  = document.getElementById("b_signBar");
  prog.classList.add("visible");
  document.getElementById("b_signAllBtn").disabled = true;

  const domain = {
    name: "69069", version: "1",
    chainId: b_signChainId, verifyingContract: CONTRACT_ADDRESS
  };

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    p.status = "signing"; p.error = null;
    b_renderPairs();
    bar.style.width = `${Math.round((i / pending.length) * 100)}%`;
    b_setStatus("b_signStatus", `Signing ${i + 1} of ${pending.length} — confirm in wallet...`, "info");

    try {
      const payloadHash  = ethers.hexlify(ethers.randomBytes(32));
      const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(p.metadata));
      const signature    = await b_signSigner.signTypedData(domain, EIP712_TYPES,
        { signer: b_signAddress, intendedTo: p.intendedTo, payloadHash, metadataHash });
      p.payloadHash = payloadHash;
      p.signature   = signature;
      p.status      = "signed";
    } catch (e) {
      p.status = "error";
      p.error  = e.shortMessage || e.message || "Signing failed / rejected";
    }
    b_renderPairs();
  }

  bar.style.width = "100%";
  setTimeout(() => { prog.classList.remove("visible"); bar.style.width = "0%"; }, 600);

  const sc = b_pairs.filter(p => p.status === "signed").length;
  const ec = b_pairs.filter(p => p.status === "error").length;
  b_setStatus("b_signStatus",
    `Done — ${sc} signed${ec > 0 ? `, ${ec} failed` : ""}.`,
    ec > 0 ? "warning" : "connected");
  document.getElementById("b_signAllBtn").disabled = false;
  if (sc > 0) document.getElementById("b_submitAllBtn").disabled = !b_submitSigner;
};

// ---------- connect batch submitting wallet ----------

document.getElementById("b_connectSubmitBtn").onclick = async () => {
  if (!window.ethereum) { b_setStatus("b_submitWalletStatus", "No wallet found - install MetaMask", "error"); return; }
  try {
    b_submitProvider = new ethers.BrowserProvider(window.ethereum);
    await b_submitProvider.send("eth_requestAccounts", []);
    b_submitSigner  = await b_submitProvider.getSigner();
    b_submitAddress = await b_submitSigner.getAddress();

    b_setBadge("b_submitWalletStatus", b_submitAddress);
    document.getElementById("b_connectSubmitBtn").textContent = "CONNECTED";
    document.getElementById("b_submitAllBtn").disabled = !b_pairs.some(p => p.status === "signed");
  } catch (e) {
    b_setStatus("b_submitWalletStatus", e.shortMessage || e.message || "Connection failed", "error");
  }
};

// ---------- submit all ----------

document.getElementById("b_submitAllBtn").onclick = async () => {
  const signed = b_pairs.filter(p => p.status === "signed");
  if (signed.length === 0) { b_setStatus("b_submitStatus", "No signed pairs to submit", "warning"); return; }

  const prog = document.getElementById("b_submitProgress");
  const bar  = document.getElementById("b_submitBar");
  prog.classList.add("visible");
  document.getElementById("b_submitAllBtn").disabled = true;

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, b_submitSigner);
  let confirmed = 0, failed = 0;

  for (let i = 0; i < signed.length; i++) {
    const p = signed[i];
    p.status = "submitting"; p.error = null;
    b_renderPairs();
    bar.style.width = `${Math.round((i / signed.length) * 100)}%`;
    b_setStatus("b_submitStatus", `Submitting ${i + 1} of ${signed.length} — confirm in wallet...`, "info");

    try {
      const tx = await contract.recordSignature(
        b_signAddress, p.intendedTo, p.payloadHash, p.signature, p.metadata
      );
      p.status = "waiting"; p.txHash = tx.hash;
      b_renderPairs();
      b_setStatus("b_submitStatus", `Waiting for confirmation ${i + 1} of ${signed.length}...`, "info");
      await tx.wait();
      p.status = "confirmed";
      confirmed++;
    } catch (e) {
      p.status = "error";
      p.error  = e.revert?.name || e.shortMessage || e.message || "Failed";
      failed++;
    }
    b_renderPairs();
  }

  bar.style.width = "100%";
  setTimeout(() => { prog.classList.remove("visible"); bar.style.width = "0%"; }, 600);

  b_setStatus("b_submitStatus",
    `Done — ${confirmed} confirmed${failed > 0 ? `, ${failed} failed` : ""}.`,
    failed > 0 ? "warning" : "connected");
  document.getElementById("b_submitAllBtn").disabled = false;
};

// ============================================================
// END BATCH SECTION
// ============================================================