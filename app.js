/*
 * app.js
 * ------
 * Iteration 7: polish and release.
 *
 * KEPT from Iterations 1-6:
 *   - Manual barcode entry (routed through handleScannedCode).
 *   - Camera start/stop, status text, friendly errors, cleanup.
 *   - ZXing decoding, 1.5 s cooldown, Last scanned label.
 *   - `bill` state + renderBill()/renderBillRows()/renderBillTotals().
 *   - Duplicate qty merge, stock check, row flash, unknown-product toast.
 *   - Per-row +/-/x buttons, discount/GST, Clear Bill, New Bill, empty state.
 *
 * ADDED in Iteration 7:
 *   - Web Audio beeps (short high = success, lower = failure) + mute toggle.
 *   - Green/red flash on the scanner panel for success/failure.
 *   - Responsive stacking on small screens (CSS) + Print invoice view.
 *   - localStorage save/restore of bill, bill number, discount and GST.
 *   - Extra accessibility labels, focus states and aria-live regions.
 *
 * SMALL REFACTOR:
 *   - calculateBillTotals() is now a pure helper. renderBillTotals() and
 *     renderInvoice() both use it, so invoice numbers can never drift from
 *     the on-screen totals. renderBill() is still the single render entry.
 */

"use strict";

// --- Settings -------------------------------------------------------------

// Ignore new decodes for this long after one is accepted.
const SCAN_COOLDOWN_MS = 1500;

// How often we try to read a frame while the camera is running.
const DECODE_INTERVAL_MS = 150;

// How long the toast stays visible.
const TOAST_DURATION_MS = 2500;

// Default values used by New Bill / Clear Bill.
const DEFAULT_DISCOUNT_PERCENT = 0;
const DEFAULT_GST_PERCENT = 18;

// localStorage key. Versioning lets us change the shape later safely.
const STORAGE_KEY = "autobiller.session.v1";

// Beep settings (plain Web Audio oscillators, no audio files).
const BEEP_SUCCESS_HZ = 880;
const BEEP_FAILURE_HZ = 330;
const BEEP_DURATION_S = 0.14;
const BEEP_VOLUME = 0.15;

// --- DOM references -------------------------------------------------------

// Scanner / scan result (Iterations 2-3, plus Iteration 7 panel/mute)
const scannerPanel = document.getElementById("scanner-panel");
const scannerVideo = document.getElementById("scanner-video");
const startButton = document.getElementById("start-camera");
const stopButton = document.getElementById("stop-camera");
const muteToggleButton = document.getElementById("mute-toggle");
const scannerStatus = document.getElementById("scanner-status");
const scannerError = document.getElementById("scanner-error");
const lastScannedValue = document.getElementById("last-scanned-value");

// Manual entry (Iteration 1)
const manualEntryForm = document.getElementById("manual-entry-form");
const barcodeInput = document.getElementById("barcode-input");

// Bill table (Iteration 4). ONLY renderBillRows() writes to this tbody.
const billItemsBody = document.getElementById("bill-items");

// Totals (Iterations 4 and 6). ONLY renderBillTotals() writes to these.
const billNumberEl = document.getElementById("bill-number");
const totalItemsEl = document.getElementById("total-items");
const itemsCountEl = document.getElementById("items-count"); // Total Quantity
const subtotalEl = document.getElementById("subtotal");
const discountPercentInput = document.getElementById("discount-percent");
const discountAmountEl = document.getElementById("discount-amount");
const gstPercentInput = document.getElementById("gst-percent");
const gstAmountEl = document.getElementById("gst-amount");
const grandTotalEl = document.getElementById("grand-total");

// Bill management buttons (Iterations 6-7)
const clearBillButton = document.getElementById("clear-bill");
const newBillButton = document.getElementById("new-bill");
const printBillButton = document.getElementById("print-bill");

// Print-only invoice (Iteration 7)
const invoiceEl = document.getElementById("invoice");
const invoiceBillNumberEl = document.getElementById("invoice-bill-number");
const invoiceDateTimeEl = document.getElementById("invoice-datetime");
const invoiceItemsBody = document.getElementById("invoice-items");
const invoiceSubtotalEl = document.getElementById("invoice-subtotal");
const invoiceDiscountEl = document.getElementById("invoice-discount");
const invoiceGstEl = document.getElementById("invoice-gst");
const invoiceGrandTotalEl = document.getElementById("invoice-grand-total");

// Toast (Iteration 4, extended in Iteration 6)
const toastEl = document.getElementById("toast");

// --- State ----------------------------------------------------------------

// Camera stream (Iteration 2)
let mediaStream = null;
let scannerRequestId = 0;

// Decoder / loop (Iteration 3)
let codeReader = null;
let decodeTimerId = null;
let isDecodingActive = false;
let unexpectedDecodeErrorLogged = false;

// Cooldown tracking. -Infinity means "no scan accepted yet".
let lastScannedCode = null;
let lastAcceptedScanTime = -Infinity;

// BILL STATE. This is the single source of truth for the table.
// Each item: { barcode, name, brand, price, qty }
const bill = [];
let billNumber = 1;

// Toast timer so repeated messages do not stack timers.
let toastTimerId = null;

// Audio (Iteration 7)
let isMuted = false;
let audioContext = null;

// --- Currency formatter ---------------------------------------------------

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Round to exactly 2 decimals using a tiny epsilon so values like 1.005
 * do not display as 1.00 because of binary floating-point error.
 * @param {number} amount - The amount to round.
 * @returns {number} A safely rounded number.
 */
function roundMoney(amount) {
  const safeNumber = Number(amount);
  if (!Number.isFinite(safeNumber)) {
    return 0;
  }
  return Math.round((safeNumber + Number.EPSILON) * 100) / 100;
}

/**
 * Format a number as Indian rupees with exactly 2 decimals.
 * @param {number} amount - The amount to format.
 * @returns {string} For example "₹185.50".
 */
function formatCurrency(amount) {
  return currencyFormatter.format(roundMoney(amount));
}

// =========================================================================
// Iteration 1-3 helpers (manual lookup, status, camera, decoder)
// =========================================================================

/**
 * Look up a product by its barcode.
 * @param {string} barcode - The typed/scanned EAN-13 code.
 * @returns {object|null} The product object, or null when not found.
 */
function findProductByBarcode(barcode) {
  return productMap.get(barcode) || null;
}

/**
 * Set the small status line under the video.
 * @param {string} statusText - Idle / Starting / Scanning / Error.
 */
function setScannerStatus(statusText) {
  scannerStatus.textContent = statusText;
  scannerStatus.dataset.state = statusText.toLowerCase();

  scannerStatus.classList.toggle("status-active", statusText === "Scanning");
  scannerStatus.classList.toggle("status-pending", statusText === "Starting");
  scannerStatus.classList.toggle("status-error", statusText === "Error");
}

/** Remove any detailed error text. */
function clearScannerError() {
  scannerError.textContent = "";
}

/**
 * Show a problem that happens before we even call getUserMedia.
 * @param {string} message - Friendly explanation for the user.
 */
function showCameraProblem(message) {
  releaseCamera();
  setScannerStatus("Error");
  scannerError.textContent = message;
  startButton.disabled = false;
  stopButton.disabled = true;
  reportFailure();
  console.warn("Camera problem:", message);
}

/**
 * Check that the page is allowed to ask for the camera.
 * @returns {boolean} True when it is safe to call getUserMedia.
 */
function canUseGetUserMedia() {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  const isHttps = protocol === "https:";
  const isLocalhost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  return Boolean(
    window.isSecureContext &&
    (isHttps || isLocalhost) &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia
  );
}

/**
 * Turn browser error names into plain-English messages.
 * @param {DOMException} error - The error thrown by getUserMedia/play().
 * @returns {string} A friendly message.
 */
function getFriendlyCameraMessage(error) {
  const errorName = error && error.name ? error.name : "";

  switch (errorName) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access in your browser settings, then try again.";

    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect a webcam (or enable your laptop camera) and try again.";

    case "NotReadableError":
    case "TrackStartError":
      return "The camera is already in use by another app or browser tab. Close it and try again.";

    default:
      return error && error.message
        ? "Could not start the camera: " + error.message
        : "Could not start the camera. Please try again.";
  }
}

/**
 * React to any camera error, clean up, and show the Error state.
 * @param {DOMException} error - The error that was thrown.
 */
function handleCameraError(error) {
  releaseCamera();
  setScannerStatus("Error");
  scannerError.textContent = getFriendlyCameraMessage(error);
  startButton.disabled = false;
  stopButton.disabled = true;
  reportFailure();
  console.error("Camera error:", error);
}

/**
 * Stop every track, clear the video, and stop the decode loop.
 */
function releaseCamera() {
  stopDecoding();

  if (mediaStream) {
    mediaStream.getTracks().forEach(function (track) {
      track.stop();
    });
    mediaStream = null;
  }

  scannerVideo.pause();
  scannerVideo.srcObject = null;
}

/**
 * Build the camera constraints.
 * @returns {object} Constraints preferring the rear camera at 1280x720.
 */
function createCameraConstraints() {
  return {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };
}

/**
 * Create (once) the ZXing reader with ONLY the formats we need.
 * @returns {object|null} The reader, or null if the CDN script did not load.
 */
function getCodeReader() {
  if (codeReader) {
    return codeReader;
  }

  if (typeof ZXing === "undefined") {
    console.error("ZXing library was not loaded. Check the CDN script tag.");
    return null;
  }

  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.CODE_128
  ]);

  codeReader = new ZXing.BrowserMultiFormatReader(hints, 0);
  return codeReader;
}

/** Reset cooldown state and the visible label before a new scanning session. */
function resetScanState() {
  lastScannedCode = null;
  lastAcceptedScanTime = -Infinity;
  unexpectedDecodeErrorLogged = false;
  lastScannedValue.textContent = "\u2014";
}

/**
 * Decide whether a decoded code should be accepted.
 * @param {string} code - The decoded barcode text.
 * @param {number} now - Current time from performance.now().
 * @returns {boolean} True when the code should be passed on.
 */
function shouldAcceptDecodedCode(code, now) {
  const timeSinceLastScan = now - lastAcceptedScanTime;

  if (code === lastScannedCode && timeSinceLastScan < SCAN_COOLDOWN_MS) {
    return false;
  }

  if (timeSinceLastScan < SCAN_COOLDOWN_MS) {
    return false;
  }

  return true;
}

/**
 * Apply cooldown rules, then hand the code to handleScannedCode().
 * @param {string} code - The decoded barcode text.
 */
function processDecodedCode(code) {
  const now = performance.now();

  if (!shouldAcceptDecodedCode(code, now)) {
    return;
  }

  lastAcceptedScanTime = now;
  lastScannedCode = code;
  handleScannedCode(code);
}

/**
 * Decode one frame. "No barcode found" is normal and is ignored quietly.
 */
function runDecodeLoop() {
  if (!isDecodingActive) {
    return;
  }

  const reader = getCodeReader();
  const videoHasFrame =
    scannerVideo.readyState >= 2 && scannerVideo.videoWidth > 0;

  if (reader && videoHasFrame) {
    try {
      const result = reader.decode(scannerVideo);
      processDecodedCode(result.getText());
    } catch (error) {
      const isNormalMiss =
        typeof ZXing !== "undefined" && error instanceof ZXing.Exception;

      if (!isNormalMiss && !unexpectedDecodeErrorLogged) {
        unexpectedDecodeErrorLogged = true;
        console.warn("Unexpected barcode decode error:", error);
      }
    }
  }

  if (isDecodingActive) {
    decodeTimerId = window.setTimeout(runDecodeLoop, DECODE_INTERVAL_MS);
  }
}

/** Start our decode timer. Safe to call repeatedly. */
function startDecoding() {
  stopDecoding();
  isDecodingActive = true;
  decodeTimerId = window.setTimeout(runDecodeLoop, DECODE_INTERVAL_MS);
}

/** Cancel the decode timer. No other loop or worker is created. */
function stopDecoding() {
  isDecodingActive = false;

  if (decodeTimerId !== null) {
    window.clearTimeout(decodeTimerId);
    decodeTimerId = null;
  }
}

// =========================================================================
// Iteration 7: feedback (beeps + panel flashes + mute)
// =========================================================================

/**
 * Get (or lazily create) one Web Audio context. Browsers require a user
 * gesture before audio can play; Start Scanner / Add to bill provide that.
 * @returns {AudioContext|null} The context, or null when audio is unavailable.
 */
function getAudioContext() {
  if (isMuted) {
    return null;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  try {
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    return audioContext;
  } catch (error) {
    console.warn("Audio feedback is unavailable:", error);
    return null;
  }
}

/**
 * Play a short generated tone. Success = higher pitch, failure = lower.
 * @param {boolean} isSuccess - True for the success tone.
 */
function playBeep(isSuccess) {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  try {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      isSuccess ? BEEP_SUCCESS_HZ : BEEP_FAILURE_HZ,
      now
    );

    // Quick fade-in/out avoids an audible click.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(BEEP_VOLUME, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_DURATION_S);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + BEEP_DURATION_S + 0.01);
  } catch (error) {
    console.warn("Could not play feedback beep:", error);
  }
}

/**
 * Restart a CSS animation on the scanner panel.
 * @param {string} kind - "success" or "error".
 */
function flashScannerPanel(kind) {
  if (!scannerPanel) {
    return;
  }

  scannerPanel.classList.remove("flash-success", "flash-error");

  // Reading offsetWidth forces the browser to apply the removal before we
  // add the class again, so repeated scans restart the animation.
  void scannerPanel.offsetWidth;

  scannerPanel.classList.add(kind === "error" ? "flash-error" : "flash-success");
}

/** Feedback for a successful add/increment. */
function reportSuccess() {
  playBeep(true);
  flashScannerPanel("success");
}

/** Feedback for unknown code, out of stock, or camera failure. */
function reportFailure() {
  playBeep(false);
  flashScannerPanel("error");
}

/** Toggle the mute state and keep the button label/ARIA in sync. */
function toggleMute() {
  isMuted = !isMuted;
  muteToggleButton.setAttribute("aria-pressed", isMuted ? "true" : "false");
  muteToggleButton.textContent = isMuted ? "Sound: Off" : "Sound: On";
  muteToggleButton.setAttribute(
    "aria-label",
    isMuted ? "Unmute scan sounds" : "Mute scan sounds"
  );
}

// =========================================================================
// Shared helpers: toast, table cells, bill item lookup/add
// =========================================================================

/**
 * Show a small non-blocking message near the bottom-right corner.
 * @param {string} message - Text to display.
 * @param {boolean} isInfo - True for a neutral blue toast, false for red/error.
 */
function showToast(message, isInfo) {
  toastEl.textContent = message;
  toastEl.classList.toggle("toast-info", Boolean(isInfo));
  toastEl.classList.add("is-visible");

  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId);
  }

  toastTimerId = window.setTimeout(function () {
    toastEl.classList.remove("is-visible");
    toastTimerId = null;
  }, TOAST_DURATION_MS);
}

/**
 * Make one <td> element for the bill table.
 * @param {string} text - Cell text.
 * @param {string} className - Optional class (used for numeric columns).
 * @returns {HTMLTableCellElement} The finished cell.
 */
function createTableCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;

  if (className) {
    cell.className = className;
  }

  return cell;
}

/**
 * Find an existing bill item by barcode.
 * @param {string} barcode - The barcode to look for.
 * @returns {object|null} The matching item, or null when it is not in the bill.
 */
function findBillItem(barcode) {
  return bill.find(function (item) {
    return item.barcode === barcode;
  }) || null;
}

/**
 * Add a product to the bill, or increase the qty if it is already there.
 * Row order is preserved because an existing item is mutated in place.
 * @param {object} product - A product from productMap.
 * @returns {object|null} The changed item, or null when stock blocked the scan.
 */
function addOrIncrementItem(product) {
  const existingItem = findBillItem(product.barcode);
  const nextQty = existingItem ? existingItem.qty + 1 : 1;

  if (nextQty > product.quantity) {
    showToast("Only " + product.quantity + " in stock for " + product.name);
    console.log("Stock limit reached:", product.name);
    return null;
  }

  if (existingItem) {
    existingItem.qty = nextQty;
    return existingItem;
  }

  const newItem = {
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    price: product.price,
    qty: 1
  };

  bill.push(newItem);
  return newItem;
}

// =========================================================================
// Rendering: renderBill() is the single entry point
// =========================================================================

/**
 * Read a percentage input safely. Empty/invalid values fall back to the
 * default; out-of-range values are clamped to 0-100 for calculation only.
 * @param {HTMLInputElement} input - The percent input.
 * @param {number} fallback - Value to use when the field is empty/invalid.
 * @returns {number} A number between 0 and 100.
 */
function readPercent(input, fallback) {
  const raw = input.value.trim();

  if (raw === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, value));
}

/**
 * Validate and tidy a percent input on change/blur. Writes the clamped value
 * back into the field and shows a toast when the user typed something invalid.
 * @param {HTMLInputElement} input - The percent input.
 * @param {number} fallback - Default to restore when the field is empty.
 * @param {string} label - Friendly field name used in the toast.
 */
function normalizePercentInput(input, fallback, label) {
  const raw = input.value.trim();
  const parsed = Number(raw);
  const isEmpty = raw === "";
  const isInvalid = isEmpty || !Number.isFinite(parsed) || parsed < 0 || parsed > 100;

  const cleanValue = readPercent(input, fallback);
  input.value = String(cleanValue);
  input.setAttribute("aria-invalid", isInvalid ? "true" : "false");

  if (isInvalid) {
    showToast(label + " must be between 0 and 100.");
  }

  return cleanValue;
}

/**
 * Build one small action button for a bill row.
 * Data attributes let the table body handle all clicks by delegation.
 * @param {string} action - decrease / increase / remove.
 * @param {string} barcode - Item barcode used to find the row in state.
 * @param {string} label - Visible button text.
 * @param {boolean} disabled - Whether the button should be disabled.
 * @param {string} itemName - Product name used for the aria-label.
 * @returns {HTMLButtonElement} The finished button.
 */
function createRowButton(action, barcode, label, disabled, itemName) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "row-btn" + (action === "remove" ? " remove-btn" : "");
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.barcode = barcode;
  button.disabled = disabled;
  button.setAttribute("aria-label", action + " quantity for " + itemName);

  return button;
}

/**
 * Pure calculation shared by the on-screen totals and the printed invoice.
 * Order: Line total -> Subtotal -> Discount -> GST -> Grand Total.
 * @returns {object} All computed values.
 */
function calculateBillTotals() {
  const totalQuantity = bill.reduce(function (sum, item) {
    return sum + item.qty;
  }, 0);

  const subtotal = roundMoney(
    bill.reduce(function (sum, item) {
      return sum + roundMoney(item.price * item.qty);
    }, 0)
  );

  const discountPercent = readPercent(discountPercentInput, DEFAULT_DISCOUNT_PERCENT);
  const discountAmount = roundMoney((subtotal * discountPercent) / 100);
  const afterDiscount = roundMoney(subtotal - discountAmount);

  const gstPercent = readPercent(gstPercentInput, DEFAULT_GST_PERCENT);
  const gstAmount = roundMoney((afterDiscount * gstPercent) / 100);
  const grandTotal = roundMoney(afterDiscount + gstAmount);

  return {
    totalQuantity: totalQuantity,
    subtotal: subtotal,
    discountPercent: discountPercent,
    discountAmount: discountAmount,
    gstPercent: gstPercent,
    gstAmount: gstAmount,
    grandTotal: grandTotal
  };
}

/**
 * Redraw ONLY the table body from the bill state.
 * Shows an empty-state row when there are no items.
 * @param {string} highlightBarcode - Optional barcode whose row should flash.
 */
function renderBillRows(highlightBarcode) {
  billItemsBody.textContent = "";

  if (bill.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "empty-row";

    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 7; // S.No, Product, Brand, Price, Qty, Total, Actions
    emptyCell.textContent = "Your bill is empty. Scan a barcode or use manual entry to add an item.";

    emptyRow.appendChild(emptyCell);
    billItemsBody.appendChild(emptyRow);
    return;
  }

  bill.forEach(function (item, index) {
    const lineTotal = roundMoney(item.price * item.qty);
    const product = findProductByBarcode(item.barcode);
    const stockLimit = product ? product.quantity : item.qty;

    const row = document.createElement("tr");

    if (item.barcode === highlightBarcode) {
      row.className = "row-highlight";
    }

    row.appendChild(createTableCell(String(index + 1)));
    row.appendChild(createTableCell(item.name));
    row.appendChild(createTableCell(item.brand));
    row.appendChild(createTableCell(formatCurrency(item.price), "num"));
    row.appendChild(createTableCell(String(item.qty), "num"));
    row.appendChild(createTableCell(formatCurrency(lineTotal), "num"));

    // Actions cell with "-" / "+" / "x" buttons.
    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";

    actionsCell.appendChild(
      createRowButton("decrease", item.barcode, "-", item.qty <= 1, item.name)
    );
    actionsCell.appendChild(
      createRowButton("increase", item.barcode, "+", item.qty >= stockLimit, item.name)
    );
    actionsCell.appendChild(
      createRowButton("remove", item.barcode, "x", false, item.name)
    );

    row.appendChild(actionsCell);
    billItemsBody.appendChild(row);
  });
}

/**
 * Recalculate and redraw ONLY the totals area from state + percent inputs.
 */
function renderBillTotals() {
  const totals = calculateBillTotals();

  billNumberEl.textContent = "#" + billNumber;
  totalItemsEl.textContent = String(bill.length);
  itemsCountEl.textContent = String(totals.totalQuantity);
  subtotalEl.textContent = formatCurrency(totals.subtotal);
  discountAmountEl.textContent = formatCurrency(totals.discountAmount);
  gstAmountEl.textContent = formatCurrency(totals.gstAmount);
  grandTotalEl.textContent = formatCurrency(totals.grandTotal);
}

/**
 * THE SINGLE RENDER ENTRY POINT.
 * Redraws the table and all totals from state. Kept from earlier iterations.
 * @param {string} highlightBarcode - Optional barcode whose row should flash.
 */
function renderBill(highlightBarcode) {
  renderBillRows(highlightBarcode);
  renderBillTotals();
}

// =========================================================================
// Row actions, percent inputs, Clear/New bill
// =========================================================================

/**
 * Change an item's qty by -1 or +1, respecting min 1 and stock limit.
 * @param {string} barcode - The item to change.
 * @param {number} delta - -1 or +1.
 */
function changeQuantity(barcode, delta) {
  const item = findBillItem(barcode);

  if (!item) {
    return;
  }

  const nextQty = item.qty + delta;

  // Minimum quantity is 1.
  if (nextQty < 1) {
    return;
  }

  // Stock limit uses the same product.quantity from data.js as scanning.
  const product = findProductByBarcode(barcode);

  if (delta > 0 && product && nextQty > product.quantity) {
    showToast("Only " + product.quantity + " in stock for " + product.name);
    reportFailure();
    return;
  }

  item.qty = nextQty;
  renderBill(barcode);
  reportSuccess();
  saveSession();
}

/**
 * Remove one item from the bill, then redraw.
 * @param {string} barcode - The item to remove.
 */
function removeItemFromBill(barcode) {
  const index = bill.findIndex(function (item) {
    return item.barcode === barcode;
  });

  if (index === -1) {
    return;
  }

  const removed = bill.splice(index, 1)[0];
  renderBill();
  saveSession();
  console.log("Removed from bill:", removed.name);
}

/**
 * One click listener for every button inside the bill table body.
 * @param {Event} event - The click event.
 */
function handleBillTableClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("button[data-action]");

  if (!button || !billItemsBody.contains(button)) {
    return;
  }

  const action = button.dataset.action;
  const barcode = button.dataset.barcode;

  if (action === "increase") {
    changeQuantity(barcode, 1);
  } else if (action === "decrease") {
    changeQuantity(barcode, -1);
  } else if (action === "remove") {
    removeItemFromBill(barcode);
  }
}

/**
 * Empty the bill and restore default settings/scan state.
 * Does NOT change the bill number.
 */
function resetBillData() {
  bill.length = 0;
  discountPercentInput.value = String(DEFAULT_DISCOUNT_PERCENT);
  gstPercentInput.value = String(DEFAULT_GST_PERCENT);
  discountPercentInput.setAttribute("aria-invalid", "false");
  gstPercentInput.setAttribute("aria-invalid", "false");
  lastScannedCode = null;
  lastAcceptedScanTime = -Infinity;
  lastScannedValue.textContent = "\u2014";
}

/** Clear Bill: confirm first, then empty the current bill (same number). */
function clearBill() {
  if (bill.length === 0) {
    showToast("Bill is already empty.", true);
    return;
  }

  const ok = window.confirm("Clear all items from Bill #" + billNumber + "?");

  if (!ok) {
    return;
  }

  resetBillData();
  renderBill();
  saveSession();
  console.log("Bill cleared. Number kept:", billNumber);
}

/** New Bill: reset everything and move to the next bill number. */
function startNewBill() {
  resetBillData();
  billNumber += 1;
  renderBill();
  saveSession();
  showToast("Started Bill #" + billNumber, true);
  console.log("Started new bill:", billNumber);
}

/** Recalculate and save live while the user types in a percent field. */
function handlePercentInput() {
  renderBill();
  saveSession();
}

/** Validate/clamp a percent field when the user finishes editing it. */
function handleDiscountChange() {
  normalizePercentInput(discountPercentInput, DEFAULT_DISCOUNT_PERCENT, "Discount");
  renderBill();
  saveSession();
}

/** Validate/clamp the GST field when the user finishes editing it. */
function handleGstChange() {
  normalizePercentInput(gstPercentInput, DEFAULT_GST_PERCENT, "GST");
  renderBill();
  saveSession();
}

// =========================================================================
// Iteration 7: localStorage persistence
// =========================================================================

/**
 * Save the current session. Everything is wrapped in try/catch so private
 * browsing modes or blocked storage never break the app.
 */
function saveSession() {
  try {
    const payload = {
      billNumber: billNumber,
      discountPercent: readPercent(discountPercentInput, DEFAULT_DISCOUNT_PERCENT),
      gstPercent: readPercent(gstPercentInput, DEFAULT_GST_PERCENT),
      bill: bill
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not save bill to localStorage:", error);
  }
}

/**
 * Restore a saved session. Product data always comes from data.js, so a
 * tampered/old localStorage entry cannot inject wrong prices or names.
 */
function loadSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);

    if (!saved || !Array.isArray(saved.bill)) {
      return;
    }

    // Restore bill number safely.
    const savedNumber = Math.floor(Number(saved.billNumber));
    billNumber = Number.isFinite(savedNumber) && savedNumber > 0 ? savedNumber : 1;

    // Restore percent fields safely.
    const savedDiscount = Number(saved.discountPercent);
    const savedGst = Number(saved.gstPercent);
    discountPercentInput.value = String(
      Number.isFinite(savedDiscount)
        ? Math.min(100, Math.max(0, savedDiscount))
        : DEFAULT_DISCOUNT_PERCENT
    );
    gstPercentInput.value = String(
      Number.isFinite(savedGst)
        ? Math.min(100, Math.max(0, savedGst))
        : DEFAULT_GST_PERCENT
    );

    // Rebuild each item from the catalog, clamping qty to current stock.
    bill.length = 0;
    saved.bill.forEach(function (savedItem) {
      if (!savedItem || typeof savedItem.barcode !== "string") {
        return;
      }

      const product = findProductByBarcode(savedItem.barcode);

      if (!product || findBillItem(product.barcode)) {
        return; // unknown product or duplicate row: ignore it
      }

      const qty = Math.floor(Number(savedItem.qty));

      if (!Number.isFinite(qty) || qty < 1) {
        return;
      }

      bill.push({
        barcode: product.barcode,
        name: product.name,
        brand: product.brand,
        price: product.price,
        qty: Math.min(qty, product.quantity)
      });
    });

    console.log("Restored saved bill. Items:", bill.length, "Number:", billNumber);
  } catch (error) {
    console.warn("Could not restore bill from localStorage:", error);
  }
}

// =========================================================================
// Iteration 7: printable invoice
// =========================================================================

/**
 * Fill the hidden print-only invoice from the same state used on screen.
 */
function renderInvoice() {
  const totals = calculateBillTotals();

  invoiceBillNumberEl.textContent = "#" + billNumber;
  invoiceDateTimeEl.textContent = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  invoiceItemsBody.textContent = "";

  if (bill.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No items in this bill.";
    row.appendChild(cell);
    invoiceItemsBody.appendChild(row);
  } else {
    bill.forEach(function (item, index) {
      const row = document.createElement("tr");
      const lineTotal = roundMoney(item.price * item.qty);

      row.appendChild(createTableCell(String(index + 1)));
      row.appendChild(createTableCell(item.name));
      row.appendChild(createTableCell(item.brand));
      row.appendChild(createTableCell(formatCurrency(item.price), "num"));
      row.appendChild(createTableCell(String(item.qty), "num"));
      row.appendChild(createTableCell(formatCurrency(lineTotal), "num"));

      invoiceItemsBody.appendChild(row);
    });
  }

  invoiceSubtotalEl.textContent = formatCurrency(totals.subtotal);
  invoiceDiscountEl.textContent = formatCurrency(totals.discountAmount);
  invoiceGstEl.textContent = formatCurrency(totals.gstAmount);
  invoiceGrandTotalEl.textContent = formatCurrency(totals.grandTotal);
}

/** Build the invoice and hand it to the browser's print dialog. */
function printBill() {
  renderInvoice();
  invoiceEl.setAttribute("aria-hidden", "false");
  window.print();
}

/** Hide the invoice from assistive tech again after the print dialog closes. */
function handleAfterPrint() {
  invoiceEl.setAttribute("aria-hidden", "true");
}

// =========================================================================
// Scan hook (single path, now with feedback + persistence)
// =========================================================================

/**
 * THE SINGLE SCAN HOOK.
 * Called by camera scans (after cooldown) AND by the manual input.
 * @param {string} code - The barcode text.
 */
function handleScannedCode(code) {
  console.log("Scanned code:", code);
  lastScannedValue.textContent = code;

  const product = findProductByBarcode(code);

  if (!product) {
    console.log("Unknown product:", code);
    showToast("Unknown product: " + code);
    reportFailure();
    return;
  }

  const changedItem = addOrIncrementItem(product);

  if (!changedItem) {
    reportFailure();
    return;
  }

  renderBill(changedItem.barcode);
  saveSession();
  reportSuccess();

  if (changedItem.qty === 1) {
    console.log("Added to bill:", changedItem.name);
  } else {
    console.log("Increased qty to", changedItem.qty, "for", changedItem.name);
  }
}

/**
 * Handle the manual test form submission.
 * It uses the same path as a real camera scan.
 * @param {Event} event - The form submit event.
 */
function handleManualSubmit(event) {
  event.preventDefault();

  const barcode = barcodeInput.value.trim();

  if (barcode === "") {
    console.log("Please enter a barcode first.");
    return;
  }

  handleScannedCode(barcode);

  barcodeInput.value = "";
  barcodeInput.focus();
}

// =========================================================================
// Start / stop camera (unchanged)
// =========================================================================

/**
 * Start the camera, show the live feed, and begin decoding.
 */
async function startScanner() {
  if (!canUseGetUserMedia()) {
    showCameraProblem(
      "Camera access needs a secure context. Open this page on http://localhost (or 127.0.0.1) or over HTTPS, then try again."
    );
    return;
  }

  if (!getCodeReader()) {
    showCameraProblem(
      "Barcode decoder could not be loaded. Check your internet connection and reload the page."
    );
    return;
  }

  resetScanState();

  const requestId = ++scannerRequestId;

  clearScannerError();
  setScannerStatus("Starting");
  startButton.disabled = true;
  stopButton.disabled = false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      createCameraConstraints()
    );

    if (requestId !== scannerRequestId) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      return;
    }

    mediaStream = stream;
    scannerVideo.srcObject = stream;
    await scannerVideo.play();

    if (requestId !== scannerRequestId) {
      releaseCamera();
      return;
    }

    setScannerStatus("Scanning");
    startDecoding();
  } catch (error) {
    if (requestId === scannerRequestId) {
      handleCameraError(error);
    }
  }
}

/**
 * Stop the camera and the decoder, and return to the Idle state.
 */
function stopScanner() {
  scannerRequestId++;
  releaseCamera();
  clearScannerError();
  setScannerStatus("Idle");
  startButton.disabled = false;
  stopButton.disabled = true;
}

// --- Wire up events -------------------------------------------------------

manualEntryForm.addEventListener("submit", handleManualSubmit);
startButton.addEventListener("click", startScanner);
stopButton.addEventListener("click", stopScanner);
muteToggleButton.addEventListener("click", toggleMute);

// One delegated listener for all row buttons.
billItemsBody.addEventListener("click", handleBillTableClick);

// Live totals while typing; strict validation when the field loses focus.
discountPercentInput.addEventListener("input", handlePercentInput);
discountPercentInput.addEventListener("change", handleDiscountChange);
gstPercentInput.addEventListener("input", handlePercentInput);
gstPercentInput.addEventListener("change", handleGstChange);

clearBillButton.addEventListener("click", clearBill);
newBillButton.addEventListener("click", startNewBill);
printBillButton.addEventListener("click", printBill);
window.addEventListener("afterprint", handleAfterPrint);

window.addEventListener("pagehide", function () {
  scannerRequestId++;
  releaseCamera();
  saveSession();
});

// Restore first, then render once so saved data is never overwritten.
loadSession();
renderBill();

console.log("Iteration 7 ready. Products loaded:", products.length);
