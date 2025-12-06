import requests

url = "https://2cb736a61ccb.ngrok-free.app/api/v2/piston/execute"

data = {
    "language": "python",
    "version": "3.10",
    "files": [
        {"content": "print('Hello from judge server!')"}
    ],
    "stdin": ""
}

res = requests.post(url, json=data)
print(res.json())
