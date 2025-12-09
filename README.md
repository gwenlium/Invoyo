# Invoyo

Invoyo is a simple, powerful tool to manage your invoices. Upload PDFs or images, automatically extract text and QR codes, and organize your payments.

> ⚠️ **Security Notice**: This is a demo/development project. Before deploying to production, please review [SECURITY.md](SECURITY.md) for required security configurations including authentication, secret keys, and database credentials.

## ✨ Features

- **Smart Extraction**: Automatically pulls text, dates, amounts, and QR codes from your documents using OCR.
- **Multi-Priority Amount Detection**: Advanced extraction algorithm checks keywords like "Rechnungsbetrag", "Total", "Betrag" with multi-line context.
- **Workflow Management**: Track invoices through statuses - "Saved" (new uploads), "Unpaid" (processed), "Paid", and "Archived".
- **Real-time Updates**: Watch your documents process live with background OCR processing.
- **Custom Styling**: Blue accent colors for archive actions, orange for unpaid status, green for paid.
- **File Type Filtering**: Filter and view documents by file type (PDF, JPG, PNG, etc.).
- **Delete Confirmation**: Beautiful minimalistic modal for file deletion.
- **Local Timestamps**: Modified times match your device's local datetime.
- **Audio Notifications**: Subtle sound effects with sustain for user actions.
- **Secure**: Built with modern security practices.

## 🚀 How to Run

You only need **Docker** installed.

### Development Mode

1.  **Clone the project**
    ```bash
    git clone <repository-url>
    cd invoiceprocessor
    ```

2.  **Start the app**
    ```bash
    docker compose -f docker-compose.dev.yml up --build
    ```

3.  **Open in Browser**
    - Frontend: [http://localhost:4200](http://localhost:4200)
    - API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Production Mode

1.  **Start the app**
    ```bash
    docker compose up --build
    ```

2.  **Access**
    - Application: [http://localhost](http://localhost)
    - API: [http://localhost:8000](http://localhost:8000)

## 📋 Document Workflow

1. **Upload**: Drop PDF or image files - instantly saved with "Saved" status
2. **Process**: Background OCR extracts text, QR codes, dates, and amounts
3. **Review**: Documents show as "Unpaid" after processing
4. **Manage**: Mark as "Paid" or edit details manually
5. **Archive**: Move paid invoices to archive for historical tracking

## 🎨 Status System

- **Saved** (Purple): Newly uploaded, awaiting or processing OCR
- **Unpaid** (Orange): Processed and awaiting payment
- **Paid** (Green): Payment confirmed
- **Archived** (Blue): Historical records

## 🛠️ Tech Stack

- **Frontend**: Angular 19 (TypeScript, Standalone Components, Signals)
- **Backend**: Python 3.11 (FastAPI, SQLAlchemy)
- **Database**: PostgreSQL 15
- **Cache**: Redis
- **OCR**: PyMuPDF, OpenCV, pyzbar (QR codes)
- **Containerization**: Docker & Docker Compose

## 🔧 Environment Configuration

Copy `example.env` to `.env` in the root directory and configure:

- Database credentials (change from defaults!)
- Redis connection
- JWT secret keys (generate a secure random key)
- Frontend API URL
- Port mappings

**Important**: Never commit `.env` files to version control. Only `example.env` templates should be in the repository.

## 🔐 Security

This project includes basic security features but requires configuration for production use:

- **Authentication**: Currently uses demo authentication (accepts any credentials)
- **Secrets**: Default secret keys must be changed
- **Database**: Default credentials must be updated
- **HTTPS**: Configure reverse proxy for production

**See [SECURITY.md](SECURITY.md) for complete security guidelines before deploying to production.**

## 📝 License

This project is open source and available for personal and commercial use.

---
Made by Gwendolyn (●'◡'●)


