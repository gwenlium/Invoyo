import requests
import os

# The URL of my docker API
url = "http://localhost:8000/docs"

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Build the path relative to the script
file_path = os.path.join(script_dir, "data", "test.pdf")

try:
    with open(file_path, "rb") as f:
        files = {"file": (file_path, f, "application/pdf")}
        response = requests.post(url.replace("/docs", "/documents/"), files=files)
        print("Response Status Code:", response.status_code)
        print("Response JSON:", response.json())

    if response.status_code == 200:
        print("File uploaded and processed successfully.")
    else: 
        print("Failed to upload/process file.")
except FileNotFoundError:
    print(f"File not found: {file_path}")