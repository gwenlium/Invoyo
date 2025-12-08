# Invoice Processor

A simple, powerful tool to manage your invoices. Upload PDFs or images, automatically extract text and QR codes, and organize your payments.

## ✨ Features

- **Smart Extraction**: Automatically pulls text, dates, amounts, and QR codes from your documents.
- **Workflow Management**: Track invoices from "Processing" to "Paid" and "Archived".
- **Real-time Updates**: Watch your documents process live.
- **Secure**: Built with modern security practices.

## 🚀 How to Run

You only need **Docker** installed.

1.  **Clone the project**
    ```bash
    git clone <repository-url>
    cd invoiceprocessor
    ```

2.  **Start the app**
    ```bash
    docker compose up --build
    ```

3.  **Open in Browser**
    - Go to: [http://localhost:4200](http://localhost:4200)
    - API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## 🛠️ Tech Stack

- **Frontend**: Angular (TypeScript)
- **Backend**: Python (FastAPI)
- **Database**: PostgreSQL
- **OCR**: PyMuPDF & OpenCV

---
*Made by Gwendolyn (●'◡'●)*


