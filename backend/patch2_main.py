with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'r') as f:
    code = f.read()

# Replace timeout and workers
code = code.replace("timeout=15", "timeout=(5, 10)")
code = code.replace("max_workers=10", "max_workers=4")

import_hvp_code = """
        print(f"Fetching {link}...", flush=True)
        resp = requests.get(link, headers=headers, timeout=(5, 10))
"""
code = code.replace('resp = requests.get(link, headers=headers, timeout=(5, 10))', import_hvp_code)

with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'w') as f:
    f.write(code)
print("Throttled extractor successfully!")
