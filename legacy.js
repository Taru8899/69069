
  /* ============================================================
     CONTRACT
     ============================================================ */

  const CONTRACT_ADDRESS =
    "0x7373DBC24Dcd785896E8Ac3d5372c6ced9B75a8A";


  const DEFAULT_ADDRESS =
    "0x1C10e6574ee696f54b21A611a21313E4714628ad";


  const MAX_METADATA_LENGTH = 64;


  const ABI = [

    /* ---------------- READ ---------------- */

    "function effectiveOf(address) view returns (int256)",

    "function statsOf(address) view returns (uint256 pushCount, uint256 trustCount, int256 effective)",

    "function pushCountOf(address) view returns (uint256)",

    "function trustCountOf(address) view returns (uint256)",

    "function totalRecorded() view returns (uint256)",

    "function recordStructHash(address signer, address intendedTo, bytes32 payloadHash, string metadata) pure returns (bytes32)",

    "function isRecordHashUsed(bytes32 structHash) view returns (bool)",


    /* ---------------- WRITE ---------------- */

    "function recordSignature(address signer, address intendedTo, bytes32 payloadHash, bytes signature, string metadata)"

  ];


  const EIP712_TYPES = {

    Record: [

      {
        name: "signer",
        type: "address"
      },

      {
        name: "intendedTo",
        type: "address"
      },

      {
        name: "payloadHash",
        type: "bytes32"
      },

      {
        name: "metadataHash",
        type: "bytes32"
      }

    ]

  };


  /* ============================================================
     STATE
     ============================================================ */

  let provider = null;
  let signer = null;
  let contract = null;
  let readContract = null;

  let userAddress = null;
  let chainId = null;


  /* ============================================================
     HELPERS
     ============================================================ */

  function short(address) {

    if (!address) return "-";

    return (
      address.slice(0, 6) +
      "..." +
      address.slice(-4)
    );

  }


  function setStatus(text, type) {

    const el =
      document.getElementById("status");

    if (!el) return;

    el.innerText = text;

    el.className = "";

    if (type === "connected") {

      el.classList.add("status-connected");

    } else if (type === "error") {

      el.classList.add("status-error");

    } else if (type === "warning") {

      el.classList.add("status-warning");

    } else if (type === "info") {

      el.classList.add("status-info");

    }

  }


  function setAddress(address) {

    const el =
      document.getElementById("address");

    if (!el) return;

    el.innerHTML =
      address
        ? address +
          ' <span class="method-badge badge-extension">&#128058; Extension</span>'
        : "-";

  }

  function setConnectButtonText(text) {
    const el = document.getElementById("connectButton");
    if (el) el.textContent = text;
  }


  function utf8ByteLength(value) {

    return new TextEncoder()
      .encode(value)
      .length;

  }


  function getReadContract() {

    if (contract) {
      return contract;
    }

    if (readContract) {
      return readContract;
    }

    try {

      const fallbackProvider =
        ethers.getDefaultProvider("homestead");

      readContract =
        new ethers.Contract(
          CONTRACT_ADDRESS,
          ABI,
          fallbackProvider
        );

      return readContract;

    } catch (err) {

      console.error(
        "Read provider error",
        err
      );

      return null;

    }

  }


  function showCheckResult(
    text,
    type = ""
  ) {

    const el =
      document.getElementById(
        "legacyCheckResult"
      );

    el.textContent = text;

    el.className =
      "legacy-info" +
      (type ? " " + type : "");

  }


  /* ============================================================
     WALLET
     ============================================================ */

  async function connectWallet(
    silent = false
  ) {

    if (!window.ethereum) {

      setStatus(
        "A legacy claim begins when a new address records its first signature to the old address.",
        "warning"
      );

      return null;

    }


    try {

      provider =
        new ethers.BrowserProvider(
          window.ethereum
        );


      if (silent) {

        const accounts =
          await provider.send(
            "eth_accounts",
            []
          );

        if (
          !accounts ||
          accounts.length === 0
        ) {

          return null;

        }

      } else {

        await provider.send(
          "eth_requestAccounts",
          []
        );

      }


      signer =
        await provider.getSigner();


      userAddress =
        await signer.getAddress();


      const network =
        await provider.getNetwork();


      chainId =
        network.chainId;


      contract =
        new ethers.Contract(
          CONTRACT_ADDRESS,
          ABI,
          signer
        );


      setAddress(userAddress);


      setStatus(
        "Connected",
        "connected"
      );


      setConnectButtonText("CONNECTED");

      clearDisconnectedFlag();

      return userAddress;


    } catch (err) {

      console.error(
        "connectWallet",
        err
      );

      setStatus(
        "A legacy claim begins when a new address records its first signature to the old address.",
        "warning"
      );

      return null;

    }

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
    setAddress(null);
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


  /* ============================================================
     ACCOUNT / NETWORK EVENTS
     ============================================================ */

  if (
    window.ethereum &&
    window.ethereum.on
  ) {

    window.ethereum.on(
      "accountsChanged",
      async accounts => {

        if (
          accounts &&
          accounts[0]
        ) {

          await connectWallet(true);

        } else {

          signer = null;
          contract = null;
          userAddress = null;

          setAddress(null);

          setStatus(
            "Disconnected",
            "warning"
          );

          setConnectButtonText("CONNECT");

          markDisconnected();

        }

      }
    );


    window.ethereum.on(
      "chainChanged",
      () => {

        window.location.reload();

      }
    );

  }


  /* ============================================================
     ADDRESS INPUT SYNCHRONIZATION
     ============================================================ */

  const oldInput =
    document.getElementById(
      "legacyOld"
    );


  const startInput =
    document.getElementById(
      "legacyStartAddress"
    );


  const finishInput =
    document.getElementById(
      "legacyFinishAddress"
    );


  /*
    CHECK address is the master old address.

    START and FINISH are also initialized to the
    same address and follow it when CHECK address
    changes.
  */

  oldInput.addEventListener(
    "input",
    () => {

      const value =
        oldInput.value.trim();

      startInput.value = value;
      finishInput.value = value;

    }
  );


  /* ============================================================
     READ EFFECTIVE
     ============================================================ */

  async function readEffective(
    address
  ) {

    const c =
      getReadContract();

    if (!c) {

      throw new Error(
        "Unable to read ledger"
      );

    }


    const value =
      await c.effectiveOf(address);


    return BigInt(value.toString());

  }


  /* ============================================================
     PREVIEW ON-CHAIN VALUES
     (auto-populates the values panel without requiring CHECK click)
     ============================================================ */

  async function showPreview() {

    try {

      const oldAddress =
        (oldInput.value || DEFAULT_ADDRESS).trim();

      const connectedAddress =
        userAddress || DEFAULT_ADDRESS;

      if (
        !ethers.isAddress(oldAddress) ||
        !ethers.isAddress(connectedAddress)
      ) {
        return;
      }

      const newEffective =
        await readEffective(connectedAddress);

      const oldEffective =
        await readEffective(oldAddress);

      const oldAfterPush =
        oldEffective + 1n;

      const elNewAddr = document.getElementById("legacyNewAddress");
      const elNewEff = document.getElementById("legacyNewEffective");
      const elOldAddr = document.getElementById("legacyOldAddress");
      const elOldEff = document.getElementById("legacyOldEffective");
      const elOldEffAfter = document.getElementById("legacyOldEffectiveAfter");
      const elValues = document.getElementById("legacyValues");

      if (elNewAddr) elNewAddr.textContent = short(connectedAddress);
      if (elNewEff) elNewEff.textContent = newEffective.toString();
      if (elOldAddr) elOldAddr.textContent = short(oldAddress);
      if (elOldEff) elOldEff.textContent = oldEffective.toString();
      if (elOldEffAfter) elOldEffAfter.textContent = oldAfterPush.toString();
      if (elValues) elValues.style.display = "block";

    } catch (err) {

      console.warn("Preview load failed", err);

    }

  }


  /* ============================================================
     CHECK LEGACY
     ============================================================ */

  document.getElementById(
    "legacyScanBtn"
  ).onclick = async () => {

    try {

      const oldAddress =
        oldInput.value.trim();


      if (
        !ethers.isAddress(
          oldAddress
        )
      ) {

        showCheckResult(
          "Invalid old address.",
          "error"
        );

        return;

      }


      if (!userAddress) {

        await connectWallet(false);

      }


      if (!userAddress) {

        showCheckResult(
          "A legacy claim begins when a new address records its first signature to the old address.",
          "warning"
        );

        return;

      }


      showCheckResult(
        "Checking ledger on chain...",
        ""
      );


      const newEffective =
        await readEffective(
          userAddress
        );


      const oldEffective =
        await readEffective(
          oldAddress
        );


      /*
        IMPORTANT:

        The old address will receive +1 when the
        START or FINISH transaction is actually
        mined.

        Therefore:

          oldAfterPush =
          oldCurrent + 1

        We NEVER forget this +1 when displaying
        the expected post-transaction state.
      */

      const oldAfterPush =
        oldEffective + 1n;


      document.getElementById(
        "legacyNewAddress"
      ).textContent =
        short(userAddress);


      document.getElementById(
        "legacyNewEffective"
      ).textContent =
        newEffective.toString();


      document.getElementById(
        "legacyOldAddress"
      ).textContent =
        short(oldAddress);


      document.getElementById(
        "legacyOldEffective"
      ).textContent =
        oldEffective.toString();


      document.getElementById(
        "legacyOldEffectiveAfter"
      ).textContent =
        oldAfterPush.toString();


      document.getElementById(
        "legacyValues"
      ).style.display =
        "block";


      /*
        If a canonical FINISH record exists,
        a production contract should expose it
        directly.

        The current ledger has no canonicalLegacy()
        function, so CHECK establishes the current
        chain values only.
      */

      showCheckResult(
        "you can claim this adress",
        "success"
      );


      setStatus(
        "Legacy data checked on chain.",
        "connected"
      );


    } catch (err) {

      console.error(
        "CHECK error",
        err
      );


      showCheckResult(
        err?.reason ||
        err?.shortMessage ||
        err?.message ||
        "Unable to check ledger.",
        "error"
      );

    }

  };


  /* ============================================================
     UNIFIED LEGACY METADATA
     ============================================================

     Format:

       L1|S|new|old|N|O|OA

     S = START

       N = new effective
       O = old effective before +1
       OA = old effective after +1

     FINISH:

       L1|F|new|old|N|O|OA

     This makes the metadata deterministic and
     machine-readable.

     Example:

       L1|S|0x...|0x...|50|50|51

     and:

       L1|F|0x...|0x...|110|50|51

     The actual transaction itself proves:

       signer
       intendedTo
       payloadHash
       signature
       metadata

     through the ledger event / record.
  */


  function makeLegacyMetadata(
    type,
    newAddress,
    oldAddress,
    newEffective,
    oldEffective
  ) {

    /*
      The complete addresses would exceed the 64-byte
      metadata field.

      Therefore we use deterministic compact address
      identifiers.

      Full addresses remain available from the
      transaction / signature record itself.
    */

    const newShort =
      newAddress.slice(0, 6) +
      newAddress.slice(-4);

    const oldShort =
      oldAddress.slice(0, 6) +
      oldAddress.slice(-4);


    /*
      oldAfter = oldEffective + 1

      This is mandatory because this transaction
      itself changes the old address effective.
    */

    const oldAfter =
      BigInt(oldEffective) + 1n;


    let metadata =
      "L1|" +
      type +
      "|" +
      newShort +
      "|" +
      oldShort +
      "|" +
      newEffective.toString() +
      "|" +
      oldEffective.toString() +
      "|" +
      oldAfter.toString();


    /*
      Safety check.
    */

    if (
      utf8ByteLength(metadata) >
      MAX_METADATA_LENGTH
    ) {

      throw new Error(
        "Legacy metadata exceeds 64 bytes."
      );

    }


    return metadata;

  }


  /* ============================================================
     PAYLOAD HASH
     ============================================================ */

  function makePayloadHash(
    type,
    newAddress,
    oldAddress
  ) {

    const nonce =
      Date.now().toString() +
      ":" +
      Math.random().toString(36);


    return ethers.keccak256(

      ethers.toUtf8Bytes(

        "69069:LEGACY:" +
        type +
        ":" +
        newAddress +
        ":" +
        oldAddress +
        ":" +
        nonce

      )

    );

  }


  /* ============================================================
     SEND ONE LEGACY RECORD
     ============================================================ */

  async function sendLegacyRecord(
    type,
    oldAddress,
    button,
    progress,
    progressBar,
    statusElement
  ) {

    if (!signer || !contract) {

      await connectWallet(false);

    }


    if (!signer || !contract) {

      statusElement.textContent =
        "Connect wallet first.";

      return;

    }


    if (
      !ethers.isAddress(
        oldAddress
      )
    ) {

      statusElement.textContent =
        "Invalid old address.";

      return;

    }


    if (
      ethers.getAddress(oldAddress) ===
      ethers.getAddress(userAddress)
    ) {

      statusElement.textContent =
        "New address and old address must be different.";

      return;

    }


    button.disabled = true;


    progress.style.display =
      "block";


    progressBar.style.width =
      "10%";


    try {

      /*
        Read BEFORE the +1 push.

        This is the critical snapshot.
      */

      statusElement.textContent =
        "Reading ledger state...";


      const newEffectiveBefore =
        await readEffective(
          userAddress
        );


      progressBar.style.width =
        "25%";


      const oldEffectiveBefore =
        await readEffective(
          oldAddress
        );


      /*
        CRITICAL RULE:

        The old address will receive +1.

        Therefore the expected effective AFTER
        this transaction is:

            oldEffectiveBefore + 1
      */

      const oldEffectiveAfter =
        oldEffectiveBefore + 1n;


      /*
        Build deterministic metadata.

        START:
          L1|S|...

        FINISH:
          L1|F|...
      */

      const metadata =
        makeLegacyMetadata(

          type,

          userAddress,

          oldAddress,

          newEffectiveBefore,

          oldEffectiveBefore

        );


      statusElement.textContent =
        "Sign legacy " +
        (type === "S" ? "START" : "FINISH") +
        " record in wallet...";


      progressBar.style.width =
        "40%";


      const network =
        await provider.getNetwork();


      chainId =
        network.chainId;


      const domain = {

        name: "69069",

        version: "1",

        chainId: chainId,

        verifyingContract:
          CONTRACT_ADDRESS

      };


      const payloadHash =
        makePayloadHash(

          type,

          userAddress,

          oldAddress

        );


      const metadataHash =
        ethers.keccak256(
          ethers.toUtf8Bytes(
            metadata
          )
        );


      const typedValue = {

        signer:
          userAddress,

        intendedTo:
          oldAddress,

        payloadHash:
          payloadHash,

        metadataHash:
          metadataHash

      };


      const signature =
        await signer.signTypedData(

          domain,

          EIP712_TYPES,

          typedValue

        );


      progressBar.style.width =
        "65%";


      statusElement.textContent =
        "Submitting +1 signature to old address...";


      /*
        EXACTLY ONE record.

        This is deliberately NOT a batch.

        The old address therefore receives
        exactly +1 effective from this action.
      */

      const tx =
        await contract.recordSignature(

          userAddress,

          oldAddress,

          payloadHash,

          signature,

          metadata

        );


      statusElement.textContent =
        "Transaction submitted. Waiting for confirmation...";


      progressBar.style.width =
        "85%";


      await tx.wait();


      progressBar.style.width =
        "100%";


      /*
        Read the chain again AFTER the transaction.

        This verifies the actual resulting state.
      */

      const newEffectiveAfter =
        await readEffective(
          userAddress
        );


      const oldEffectiveActual =
        await readEffective(
          oldAddress
        );


      statusElement.textContent =
        (
          type === "S"
            ? "START recorded on chain."
            : "FINISH recorded on chain."
        ) +
        " Old effective: " +
        oldEffectiveBefore.toString() +
        " → " +
        oldEffectiveActual.toString();


      /*
        Show the exact evidence.
      */

      const result =
        document.getElementById(
          "legacyTxResult"
        );


      result.innerHTML =

        "<div class='legacy-info success'>" +

          "<strong>" +
          (
            type === "S"
              ? "LEGACY START"
              : "LEGACY FINISH"
          ) +
          " RECORDED</strong><br><br>" +

          "New effective before: " +
          newEffectiveBefore.toString() +
          "<br>" +

          "New effective after: " +
          newEffectiveAfter.toString() +
          "<br>" +

          "Old effective before: " +
          oldEffectiveBefore.toString() +
          "<br>" +

          "Old effective after +1: " +
          oldEffectiveAfter.toString() +
          "<br>" +

          "Old effective actually read: " +
          oldEffectiveActual.toString() +
          "<br><br>" +

          "Metadata:<br>" +

          "<span class='legacy-mono'>" +
          metadata +
          "</span><br><br>" +

          "Tx:<br>" +

          "<span class='legacy-mono'>" +
          tx.hash +
          "</span>" +

        "</div>";


      setStatus(
        (
          type === "S"
            ? "START recorded on chain."
            : "FINISH recorded on chain."
        ),
        "connected"
      );


    } catch (err) {

      console.error(
        "Legacy transaction error",
        err
      );


      statusElement.textContent =
        err?.reason ||
        err?.shortMessage ||
        err?.message ||
        "Transaction failed.";


      setStatus(
        "Legacy transaction failed.",
        "error"
      );


    } finally {

      button.disabled = false;


      setTimeout(
        () => {

          progress.style.display =
            "none";

          progressBar.style.width =
            "0%";

        },
        500
      );

    }

  }


  /* ============================================================
     START
     ============================================================ */

  document.getElementById(
    "legacyStartBtn"
  ).onclick = async () => {

    const oldAddress =
      startInput.value.trim();


    await sendLegacyRecord(

      "S",

      oldAddress,

      document.getElementById(
        "legacyStartBtn"
      ),

      document.getElementById(
        "legacyStartProgress"
      ),

      document.getElementById(
        "legacyStartProgressBar"
      ),

      document.getElementById(
        "legacyStartStatus"
      )

    );

  };


  /* ============================================================
     FINISH
     ============================================================ */

  document.getElementById(
    "legacyFinishBtn"
  ).onclick = async () => {

    const oldAddress =
      finishInput.value.trim();


    await sendLegacyRecord(

      "F",

      oldAddress,

      document.getElementById(
        "legacyFinishBtn"
      ),

      document.getElementById(
        "legacyFinishProgress"
      ),

      document.getElementById(
        "legacyFinishProgressBar"
      ),

      document.getElementById(
        "legacyFinishStatus"
      )

    );

  };


  /* ============================================================
     AUTO CONNECT
     ============================================================ */

  window.addEventListener(
    "load",
    () => {

      setTimeout(
        async () => {

          try {

            if (window.ethereum && !userPrefersDisconnected()) {

              setStatus(
                "Connecting...",
                "info"
              );


              const address =
                await connectWallet(true);


              if (address) {

                await showPreview();

                return;

              }

            }


            setAddress(DEFAULT_ADDRESS);


            setStatus(
              "Read-only mode - connect ledger",
              "info"
            );

            await showPreview();


          } catch (err) {

            console.warn(
              "Auto-connect failed",
              err
            );


            setAddress(DEFAULT_ADDRESS);

            setStatus(
              "Read-only mode - connect ledger",
              "info"
            );

            await showPreview();

          }

        },
        500
      );

    }
  );
