import requests
import sys

BASE_URL = "http://localhost:8000/api"

def test_register():
    print("Testing Registration...")
    payload = {
        "email": "test@example.com",
        "username": "testuser",
        "password": "Password123!"
    }
    try:
        response = requests.post(f"{BASE_URL}/auth/register", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return response.status_code == 201
    except Exception as e:
        print(f"Error: {e}")
        return False

def test_login():
    print("\nTesting Login...")
    payload = {
        "username": "testuser",
        "password": "Password123!"
    }
    try:
        response = requests.post(f"{BASE_URL}/auth/login", json=payload)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return response.status_code == 200
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    if test_register():
        test_login()
    else:
        # If register failed because user exists (400), try login anyway
        print("Registration failed (maybe user exists), trying login...")
        test_login()
