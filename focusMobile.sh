#!/bin/bash

# ─────────────────────────────────────────
#  focusMobile Launcher
#  يشغّل المشروع على الشبكة المحلية
#  للوصول من أجهزة أخرى على نفس الـ WiFi
# ─────────────────────────────────────────

PROJECT_DIR="/home/mosamir/Desktop/mahara super"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# ── ألوان ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── اعرف الـ IP ──
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' | head -1)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(hostname -I | awk '{print $1}')
fi

FRONTEND_URL="http://$LOCAL_IP:$FRONTEND_PORT"
BACKEND_URL="http://$LOCAL_IP:$BACKEND_PORT"

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   focusLearn Mobile — Network Mode 📡    ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}   IP الجهاز: $LOCAL_IP${NC}"
echo ""

# ── تحقق من المشروع ──
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}✗ مش لاقي المشروع: $PROJECT_DIR${NC}"
    exit 1
fi

# ── إيقاف أي instance قديم ──
echo -e "${YELLOW}⟳ Stopping old instances...${NC}"
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# ── تشغيل Backend على كل الـ interfaces ──
echo -e "${GREEN}▶ Starting Backend on 0.0.0.0:$BACKEND_PORT ...${NC}"
cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}  Creating virtual environment...${NC}"
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt -q 2>/dev/null

# الفرق المهم: --host 0.0.0.0 بدل localhost
nohup uvicorn main:app --host 0.0.0.0 --port $BACKEND_PORT > /tmp/focuslearn_backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}  ✓ Backend PID: $BACKEND_PID${NC}"

# ── انتظر Backend ──
echo -e "${YELLOW}⟳ Waiting for backend...${NC}"
for i in {1..15}; do
    if curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Backend ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# ── تشغيل Frontend مع --host ──
echo -e "${GREEN}▶ Starting Frontend on 0.0.0.0:$FRONTEND_PORT ...${NC}"
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Installing npm packages...${NC}"
    npm install -q
fi

# الفرق المهم: --host يعرّض Vite على الشبكة
nohup npm run dev -- --host > /tmp/focuslearn_frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}  ✓ Frontend PID: $FRONTEND_PID${NC}"

# ── انتظر Frontend ──
echo -e "${YELLOW}⟳ Waiting for frontend...${NC}"
for i in {1..20}; do
    if curl -s "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Frontend ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# ── افتح على جهازك ──
sleep 1
if command -v brave-browser &> /dev/null; then
    brave-browser "$FRONTEND_URL" &
elif command -v brave &> /dev/null; then
    brave "$FRONTEND_URL" &
else
    xdg-open "$FRONTEND_URL" &
fi

# ── اعرض الروابط ──
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   focusLearn شغّال على الشبكة! 🚀         ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}من جهازك:${NC}"
echo -e "  Frontend → ${GREEN}http://localhost:$FRONTEND_PORT${NC}"
echo -e "  Backend  → ${GREEN}http://localhost:$BACKEND_PORT${NC}"
echo ""
echo -e "  ${CYAN}من جهاز تاني على نفس الشبكة:${NC}"
echo -e "  Frontend → ${GREEN}$FRONTEND_URL${NC}"
echo -e "  Backend  → ${GREEN}$BACKEND_URL${NC}"
echo ""
echo -e "${YELLOW}  لإيقاف المشروع: اضغط Ctrl+C${NC}"
echo ""

# ── انتظر ──
trap "echo -e '${RED}Stopping focusLearn...${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait $BACKEND_PID
