# WriteOff - Effortless Tax Deduction Management

<p align="center">
  <img src="/writeofflogo.png" alt="WriteOff Logo" width="64" height="64">
  <h1 align="center">WriteOff</h1>
</p>

<p align="center">
  Effortless tax deduction management for freelancers and small businesses
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#getting-started"><strong>Getting Started</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a> ·
  <a href="#contributing"><strong>Contributing</strong></a>
</p>
<br/>

WriteOff is a comprehensive tax deduction management platform that helps freelancers, contractors, and small business owners automatically track, categorize, and optimize their business expenses for maximum tax savings.

## 🚀 Features

- **AI-Powered Transaction Analysis** - Automatically categorizes and analyzes transactions for tax deductibility
- **Bank Account Integration** - Connect multiple bank accounts via Plaid for automatic transaction import
- **Smart Categorization** - AI-driven expense categorization with business/personal classification
- **Tax Savings Calculator** - Real-time calculation of potential tax savings based on your tax bracket
- **Receipt Management** - Upload and organize receipts with OCR text extraction
- **Tax Reports** - Generate comprehensive reports for tax preparation
- **Mobile-First Design** - Responsive interface optimized for mobile and desktop
- **Real-time Analytics** - Dashboard with insights into spending patterns and deduction opportunities

## 🛠️ Tech Stack

- **Next.js 14** with App Router
- **Firebase** for authentication and database
- **Plaid API** for bank account integration
- **OpenAI API** for AI-powered transaction analysis
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Lucide React** for icons
- **React Query** for data fetching and caching
- **ESLint** and **Prettier** for code quality

## 🏗️ Project Structure

The application is organized into clear, modular components:

### Core Components (`components/`)
- **Dashboard** - Main overview with tax savings and transaction summaries
- **Transaction Management** - Detailed transaction views and categorization
- **Bank Integration** - Plaid Link integration for account connection
- **Receipt Upload** - OCR-powered receipt processing
- **Tax Reports** - Comprehensive reporting and export functionality

### Backend Operations (`lib/`)
- **Firebase Integration** - User authentication and data management
- **Plaid Integration** - Bank account connection and transaction sync
- **AI Analysis** - OpenAI-powered transaction categorization
- **Tax Calculations** - Federal tax bracket calculations and savings estimates

### API Routes (`app/api/`)
- **Authentication** - User signup, login, and profile management
- **Plaid Integration** - Link token generation and transaction syncing
- **AI Analysis** - Transaction analysis and categorization
- **Tax Calculations** - Quarterly tax estimates and savings calculations

## Key Features

- **Plaid Integration**: Connect bank accounts and fetch transactions
- **AI Analysis**: OpenAI-powered transaction categorization and deduction analysis
- **Database Management**: Organized Supabase operations for users and transactions
- **Modular Architecture**: Clean separation of concerns with reusable functions

## Environment Variables

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV` (sandbox/development/production)
- `OPENAI_API_KEY`

## Usage

Import functions from the main API index:
```typescript
import { 
  createLinkToken, 
  fetchTransactions, 
  analyzeAllTransactions,
  getTransactions 
} from '@/lib/api'
```

This structure provides a clean, maintainable backend with clear separation between database operations, Plaid API calls, and OpenAI analysis functions.
