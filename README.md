# Barcode Auto-Biller

A simple point-of-sale demo that adds products to a bill by scanning barcodes with the webcam or by typing a barcode manually. Built with plain HTML, CSS and JavaScript only — no frameworks, npm or build tools.

## Features

- Live webcam barcode scanning with ZXing-js loaded from a CDN.
- Manual barcode entry for testing without a camera.
- Product lookup from `data.js`, duplicate merge, quantity controls and stock checks.
- Discount %, GST %, subtotal, grand total and printed invoice.
- Success/failure beeps (Web Audio API), mute toggle and green/red scanner flash.
- Responsive stacked layout on small screens.
- Current bill saved to `localStorage` and restored after reload.
- Accessible labels, focus styles and `aria-live` status/toast messages.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, scanner/bill UI and hidden printable invoice. |
| `style.css` | Layout, responsive rules, feedback flashes and print styles. |
| `data.js` | 25 sample products, `productMap` and stock quantities. |
| `app.js` | All logic: camera, decoding, bill state, rendering, feedback, storage and printing. |
| `HOW_IT_WORKS.txt` | Detailed plain-English explanation of how the system is built and works. |

## Run locally

1. Keep all files in the same folder.
2. Serve the folder using one of these methods:
   - VS Code **Live Server**, or
   - `python -m http.server 8000`
3. Open `http://localhost:8000` in your browser.

Camera access works only on `localhost`, `127.0.0.1` or HTTPS. The ZXing CDN also needs an internet connection the first time the page loads.

## Test barcodes

| Barcode | Product |
| --- | --- |
| `8901000000015` | Classic Cola 500ml |
| `8901000000024` | Basmati Rice 1kg |
| `8901000000033` | Whole Wheat Bread |
| `8901000000042` | Farm Fresh Milk 1L |
| `8901000000051` | Detergent Powder 1kg |
| `8901000000112` | Whole Wheat Atta 5kg (stock 30, useful for stock-limit tests) |

Any other 13-digit number can be used to test the unknown-product failure feedback.

## Deploy

### GitHub Pages

1. Create a GitHub account and a new public repository.
2. Upload `index.html`, `style.css`, `data.js`, `app.js`, `README.md` and `HOW_IT_WORKS.txt`.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, set **Source = Deploy from a branch**.
5. Choose branch `main` and folder `/ (root)`, then click **Save**.
6. Wait a minute and open the URL shown on the Pages settings screen.
7. Test Start Scanner on the HTTPS `github.io` URL.

### Netlify

1. Create a Netlify account.
2. Drag the project folder onto the Netlify dashboard, or connect your GitHub repository.
3. No build command is needed; publish directory is the folder containing `index.html`.
4. Click **Deploy**.
5. Open the generated HTTPS URL and test the scanner.

## Notes / limitations

- No backend: products and stock come only from `data.js`.
- Stock is not decremented permanently; it is only a limit for the current bill.
- Refreshing restores the saved bill, but clearing browser storage removes it.
- The shop name/address in the printed invoice is sample text in `index.html`.
