#!/bin/bash

# ─────────────────────────────────────────
#  focusLearn Launcher
#  يقوم المشروع ويفتحه في Brave
# ─────────────────────────────────────────

PROJECT_DIR="/home/mosamir/Desktop/mahara super"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
FRONTEND_URL="http://localhost:5173"
BACKEND_PORT=8000

# ── ألوان للـ terminal ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   focusLearn — Starting up...       ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── تحقق من وجود المشروع ──
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}✗ مش لاقي المشروع في: $PROJECT_DIR${NC}"
    echo -e "${YELLOW}  عدّل متغير PROJECT_DIR في أول السكريبت${NC}"
    read -p "Press Enter to close..."
    exit 1
fi

# ── تحقق من Python ──
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python3 مش مثبت!${NC}"
    read -p "Press Enter to close..."
    exit 1
fi

# ── تحقق من Node ──
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js مش مثبت!${NC}"
    read -p "Press Enter to close..."
    exit 1
fi

# ── إيقاف أي instance قديم ──
echo -e "${YELLOW}⟳ Stopping old instances...${NC}"
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# ── تشغيل Backend ──
echo -e "${GREEN}▶ Starting Backend (FastAPI)...${NC}"
cd "$BACKEND_DIR"

# أنشئ venv لو مش موجود
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}  Creating virtual environment...${NC}"
    python3 -m venv .venv
fi

# فعّل venv وثبّت المتطلبات
source .venv/bin/activate

# ثبّت المتطلبات بصمت لو في تغيير
pip install -r requirements.txt -q 2>/dev/null

# شغّل Backend في الخلفية
nohup uvicorn main:app --port $BACKEND_PORT 2>/tmp/focuslearn_backend.log &
BACKEND_PID=$!
echo -e "${GREEN}  ✓ Backend PID: $BACKEND_PID${NC}"

# ── انتظر Backend يجهز ──
echo -e "${YELLOW}⟳ Waiting for backend...${NC}"
for i in {1..15}; do
    if curl -s "http://localhost:$BACKEND_PORT" > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Backend ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done

# ── تشغيل Frontend ──
echo -e "${GREEN}▶ Starting Frontend (Vite)...${NC}"
cd "$FRONTEND_DIR"

# ثبّت node_modules لو مش موجودة
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Installing npm packages...${NC}"
    npm install -q
fi

# شغّل Vite في الخلفية
nohup npm run dev > /tmp/focuslearn_frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}  ✓ Frontend PID: $FRONTEND_PID${NC}"

# ── انتظر Frontend يجهز ──
echo -e "${YELLOW}⟳ Waiting for frontend...${NC}"
for i in {1..20}; do
    if curl -s "$FRONTEND_URL" > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Frontend ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done

# ── افتح Brave ──
echo -e "${GREEN}▶ Opening Brave Browser...${NC}"
sleep 1

if command -v brave-browser &> /dev/null; then
    brave-browser "$FRONTEND_URL" &
elif command -v brave &> /dev/null; then
    brave "$FRONTEND_URL" &
else
    echo -e "${YELLOW}  Brave مش موجود، بفتح على المتصفح الافتراضي...${NC}"
    xdg-open "$FRONTEND_URL" &
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   focusLearn is running! 🚀          ${NC}"
echo -e "${GREEN}   Frontend: $FRONTEND_URL            ${NC}"
echo -e "${GREEN}   Backend:  http://localhost:$BACKEND_PORT ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}  لإيقاف المشروع: اضغط Ctrl+C${NC}"
echo ""

# ── انتظر ── (لو أغلقت الـ terminal يوقف المشروع)
trap "echo -e '${RED}Stopping focusLearn...${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

wait $BACKEND_PID
