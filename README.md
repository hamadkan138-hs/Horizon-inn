# 🏨 Horizon Inn - Hotel Management System

A premium guest house management system built with **React**, **Flask**, and **PostgreSQL**. Features AI-powered booking assistance, customer management, and comprehensive admin analytics.

**Location:** Peshawar | **Pricing:** 5,000 - 9,000 PKR

---

## 🌟 Features

### 👥 Customer Features
- ✨ Beautiful homepage with hero section
- 🛏️ Room browsing with images and pricing
- 📅 Easy booking system (check-in/check-out)
- 🍽️ Food ordering system
- 📄 Invoice generation
- 📱 Fully responsive mobile design

### 🏢 Admin Dashboard
- 👨‍💼 Customer records management
- 🛏️ Room status tracking
- 📊 Booking management
- 💰 Revenue analytics (daily/monthly)
- 📈 Business insights

### 🤖 AI Integration
- 💬 Claude API for smart booking suggestions
- 🔄 Automated customer response messages

### 🔐 Security
- Secure admin authentication
- Role-based access control
- Environment variable protection

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 18 + Vite |
| **UI Framework** | Tailwind CSS |
| **Backend** | Python Flask |
| **Database** | PostgreSQL |
| **AI** | Claude API (Anthropic) |
| **Deployment** | Vercel (Frontend) / Railway (Backend) |

---

## 📁 Project Structure

```
Horizon-inn/
├── frontend/                 # React + Vite application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components
│   │   ├── services/        # API services
│   │   ├── styles/          # Global styles
│   │   └── App.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/                 # Flask API
│   ├── app.py              # Main Flask application
│   ├── config.py           # Configuration
│   ├── models/             # Database models
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic & Claude AI
│   ├── middleware/         # Authentication & validation
│   ├── requirements.txt    # Python dependencies
│   └── .env.example        # Environment variables template
│
├── database/               # Database schemas
│   └── schema.sql          # PostgreSQL schema
│
├── docs/                   # Documentation
│   ├── SETUP.md            # Setup instructions
│   ├── API.md              # API documentation
│   └── DEPLOYMENT.md       # Deployment guide
│
└── .gitignore             # Git ignore file
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- Python 3.8+
- PostgreSQL 12+
- Claude API key

### Installation

#### 1️⃣ Clone Repository
```bash
git clone https://github.com/hamadkan138-hs/Horizon-inn.git
cd Horizon-inn
```

#### 2️⃣ Setup Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
python app.py
```

#### 3️⃣ Setup Frontend
```bash
cd ../frontend
npm install
npm run dev
```

#### 4️⃣ Setup Database
```bash
# Create PostgreSQL database
createdb horizon_inn

# Run schema
psql horizon_inn < ../database/schema.sql
```

---

## 📖 Documentation

- **[Setup Guide](./docs/SETUP.md)** - Detailed installation & configuration
- **[API Documentation](./docs/API.md)** - All API endpoints
- **[Deployment Guide](./docs/DEPLOYMENT.md)** - Deploy to production

---

## 🔑 Environment Variables

### Backend (.env)
```env
FLASK_ENV=production
DATABASE_URL=postgresql://user:password@localhost/horizon_inn
SECRET_KEY=your-secret-key-here
CLAUDE_API_KEY=your-claude-api-key
JWT_SECRET=your-jwt-secret
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:5000/api
```

---

## 📊 API Endpoints

### Rooms
- `GET /api/rooms` - List all rooms
- `GET /api/rooms/:id` - Get room details
- `POST /api/rooms` - Create room (Admin)
- `PUT /api/rooms/:id` - Update room (Admin)

### Bookings
- `GET /api/bookings` - List bookings
- `POST /api/bookings` - Create booking
- `GET /api/bookings/:id` - Get booking details
- `PUT /api/bookings/:id` - Update booking

### Orders
- `GET /api/orders` - List orders
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order details

### Admin Analytics
- `GET /api/admin/dashboard` - Dashboard stats
- `GET /api/admin/analytics/daily` - Daily revenue
- `GET /api/admin/analytics/monthly` - Monthly revenue

---

## 🤖 Claude AI Features

### Smart Booking Suggestions
```python
# Suggests best available rooms based on guest preferences
/api/ai/suggest-rooms
```

### Auto Customer Messages
```python
# Generate personalized responses to customer inquiries
/api/ai/generate-response
```

---

## 🌐 Deployment

### Frontend (Vercel)
```bash
cd frontend
npm run build
# Deploy using Vercel CLI or GitHub integration
```

### Backend (Railway)
```bash
# Push to Railway with GitHub integration
# Set environment variables in Railway dashboard
```

### Database (PlanetScale)
```bash
# Create MySQL database on PlanetScale
# Update DATABASE_URL in Railway env variables
```

---

## 📱 Responsive Design

✅ Mobile First Approach  
✅ Tablet Optimization  
✅ Desktop Experience  
✅ Touch-Friendly UI  

---

## 🔒 Security Features

- ✅ JWT Authentication
- ✅ Password Hashing (bcrypt)
- ✅ CORS Protection
- ✅ SQL Injection Prevention (SQLAlchemy ORM)
- ✅ Environment Variable Protection
- ✅ Rate Limiting
- ✅ Input Validation

---

## 🐛 Troubleshooting

### Database Connection Error
```bash
# Check PostgreSQL is running
psql postgres
# Verify DATABASE_URL in .env
```

### Claude API Error
```bash
# Verify API key in .env
# Check API usage limits
```

### Port Already in Use
```bash
# Change port in Flask app.py or React vite.config.js
```

---

## 📞 Support & Contact

- **Website:** horizoninn.click
- **Email:** info@horizoninn.click
- **Location:** Peshawar, Pakistan

---

## 📄 License

MIT License - feel free to use this for your project

---

## ✨ Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

---

**Built with ❤️ by Horizon Inn Development Team**
