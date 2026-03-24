import re
text = '{"path":"https:\\/\\/youtu.be\\/hJlVluoytK8","mime":"video\\/YouTube"}'
text = text.replace("\\/", "/")
patterns = [
    r"youtube\.com/embed/([A-Za-z0-9_-]{11})",
    r"youtube\.com/watch\?v=([A-Za-z0-9_-]{11})",
    r"youtu\.be/([A-Za-z0-9_-]{11})",
]
ids = []
for p in patterns:
    ids.extend(re.findall(p, text))
print(f"Extracted IDs test 1: {ids}")

with open('/tmp/mahara_page.html', 'r', encoding='utf-8') as f:
    text2 = f.read()
text2 = text2.replace("\\/", "/")

ids2 = []
for p in patterns:
    ids2.extend(re.findall(p, text2))

print(f"Extracted IDs test 2: {list(dict.fromkeys(ids2))}")
