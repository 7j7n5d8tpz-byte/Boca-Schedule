# Football Team Player Selection System - Technical Specification Document

**Version:** 1.0  
**Date:** May 14, 2026  
**Document Status:** Ready for Development

---

## 1. EXECUTIVE SUMMARY

### 1.1 System Purpose
The Football Team Player Selection System is a web-based application designed to optimize player selection for football matches using linear programming while ensuring fairness, position coverage, and strategic priority weighting. The system serves three primary stakeholder groups:

- **Players** (~20-30 users): Sign up for matches, track personal statistics, and manage profiles
- **Coaches** (1-2 users): Create matches, manage signups, run optimization algorithms, and publish schedules
- **Administrators** (1 user): Control access, manage data integrity, and monitor system health

### 1.2 Core Value Proposition
1. **Automated Fairness**: Mathematical optimization ensures equitable distribution of playing time based on signup history
2. **Strategic Flexibility**: Coaches can designate priority players and manually override automated selections
3. **Data-Driven Insights**: Comprehensive statistics tracking for individual and team performance
4. **Operational Efficiency**: Streamlined signup process with automated email notifications
5. **Position Coverage**: Intelligent selection ensuring all field positions are adequately covered

### 1.3 High-Level Technical Approach
- **Frontend**: React-based single-page application with responsive design
- **Backend**: Node.js REST API with Express framework
- **Optimization Engine**: Julia-based linear programming solver (JuMP + HiGHS/Gurobi)
- **Database**: Supabase (PostgreSQL) with free tier
- **Hosting**: Vercel (frontend) + Railway (backend/optimization service)
- **Authentication**: Supabase Auth with JWT tokens
- **Notifications**: SendGrid free tier (100 emails/day)

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Technology Stack

#### Frontend
- **Framework**: React 18.x with TypeScript
- **State Management**: React Context API + TanStack Query (React Query)
- **UI Library**: Tailwind CSS + shadcn/ui components
- **Form Handling**: React Hook Form + Zod validation
- **Charts**: Recharts for statistics visualization
- **HTTP Client**: Axios with interceptors for auth

#### Backend
- **Runtime**: Node.js 20.x LTS
- **Framework**: Express.js 4.x
- **Language**: TypeScript
- **Validation**: Zod schemas
- **API Documentation**: Swagger/OpenAPI 3.0
- **Process Manager**: PM2 (for production)

#### Optimization Service
- **Language**: Julia 1.10+
- **Optimization Framework**: JuMP.jl
- **Solver**: HiGHS (open-source, free) with fallback to GLPK
- **Alternative**: Gurobi (academic license if available)
- **API Interface**: HTTP REST endpoint via Julia HTTP.jl server
- **Containerization**: Docker for isolated execution

#### Database
- **Primary Database**: Supabase (managed PostgreSQL)
- **Free Tier Limits**: 500MB database, 2GB bandwidth/month, 50MB file storage
- **ORM**: Prisma (Node.js) for type-safe database access
- **Migrations**: Prisma Migrate
- **Backup Strategy**: Supabase automatic daily backups (retained 7 days)

#### Authentication
- **Provider**: Supabase Auth
- **Method**: JWT tokens with refresh token rotation
- **Session Duration**: 1 hour (access token), 7 days (refresh token)
- **Password Requirements**: Min 8 characters, 1 uppercase, 1 number, 1 special char

#### Hosting & Deployment
- **Frontend Hosting**: Vercel (free tier: unlimited bandwidth, 100GB/month)
- **Backend Hosting**: Railway (free tier: $5 credit/month, ~500 hours)
- **Optimization Service**: Railway (separate service, Docker container)
- **CDN**: Vercel Edge Network (automatic)
- **SSL**: Automatic via hosting providers

#### Email Notifications
- **Provider**: SendGrid (free tier: 100 emails/day)
- **Alternative**: Resend (free tier: 100 emails/day, better developer experience)
- **Template Engine**: Handlebars for email templates
- **Fallback**: SMTP via Gmail (if SendGrid quota exceeded)

### 2.2 Architecture Diagram Description

```
┌─────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │   React SPA (Vercel)                              │   │
│  │   - Player Dashboard    - Coach Interface         │   │
│  │   - Statistics Views    - Admin Panel             │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │ HTTPS/REST
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │   Express.js API Server (Railway)                 │   │
│  │   - Authentication Middleware                     │   │
│  │   - Request Validation (Zod)                      │   │
│  │   - Rate Limiting                                 │   │
│  │   - Error Handling                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
           │                    │                    │
           │ Prisma ORM         │ HTTP               │ SMTP
           ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
│   Supabase       │  │  Optimization    │  │  SendGrid    │
│   PostgreSQL     │  │  Service         │  │  Email API   │
│   Database       │  │  (Julia/Railway) │  │              │
│                  │  │                  │  │              │
│  - Users         │  │  - JuMP Model    │  │  - Templates │
│  - Matches       │  │  - HiGHS Solver  │  │  - Queue     │
│  - Signups       │  │  - HTTP.jl API   │  │              │
│  - Selections    │  │                  │  │              │
│  - Performance   │  │                  │  │              │
└──────────────────┘  └──────────────────┘  └──────────────┘
```

**Data Flow for Optimization:**
1. Coach triggers optimization via UI
2. Frontend sends POST request to `/api/matches/:id/optimize`
3. API server validates request and fetches signup data from database
4. API server sends optimization request to Julia service with JSON payload
5. Julia service solves LP model and returns optimal selection
6. API server stores results in Selections table
7. API server returns results to frontend for display

### 2.3 Deployment Strategy

#### Environment Setup
```
Development:
- Local PostgreSQL (Docker) or Supabase dev project
- Local Node.js server (nodemon for hot reload)
- Local Julia REPL for optimization testing
- Environment: .env.local

Staging:
- Supabase staging project
- Railway staging deployment (separate service)
- Vercel preview deployments (automatic on PR)
- Environment: .env.staging

Production:
- Supabase production project
- Railway production deployment
- Vercel production deployment
- Environment: .env.production
```

#### CI/CD Pipeline
```yaml
# GitHub Actions Workflow
Trigger: Push to main branch or PR

Steps:
1. Lint & Type Check (ESLint, TypeScript)
2. Unit Tests (Jest, React Testing Library)
3. Integration Tests (Supertest for API)
4. Build Frontend (React production build)
5. Build Backend (TypeScript compilation)
6. Build Optimization Service (Julia Docker image)
7. Deploy to Staging (automatic on PR merge)
8. Manual Approval Gate
9. Deploy to Production (Vercel + Railway)
10. Post-Deployment Health Check
11. Rollback on Failure
```

#### Monitoring & Logging
- **Application Monitoring**: Railway built-in metrics (CPU, memory, requests)
- **Error Tracking**: Sentry (free tier: 5K events/month)
- **Logging**: Winston (Node.js) with log levels (error, warn, info, debug)
- **Log Storage**: Railway logs (7-day retention on free tier)
- **Uptime Monitoring**: UptimeRobot (free tier: 50 monitors, 5-min intervals)
- **Performance**: Vercel Analytics (free tier included)

---

## 3. DATABASE SCHEMA

### 3.1 Users Table
```sql
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Handled by Supabase Auth
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('player', 'coach', 'admin')),
    preferred_positions TEXT[], -- Array: ['GK', 'DEF', 'MID', 'FWD']
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

-- Constraints
ALTER TABLE users ADD CONSTRAINT email_format 
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$');
```

### 3.2 Matches Table
```sql
CREATE TABLE matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_date DATE NOT NULL,
    match_time TIME NOT NULL,
    location VARCHAR(200) NOT NULL,
    match_type VARCHAR(20) NOT NULL CHECK (match_type IN ('futsal', '7-player', '11-player')),
    
    -- Signup window
    signup_open_date TIMESTAMP WITH TIME ZONE NOT NULL,
    signup_close_date TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Player constraints
    min_players INTEGER NOT NULL CHECK (min_players > 0),
    max_players INTEGER NOT NULL CHECK (max_players >= min_players),
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'signup_open', 'signup_closed', 'optimized', 'published', 'completed')),
    
    -- Optimization settings
    priority_enabled BOOLEAN DEFAULT true,
    optimization_weights JSONB DEFAULT '{\"fairness\": 0.9, \"deficit\": 1.0, \"position_coverage\": -1.0, \"preferred_position\": -0.5}'::jsonb,
    
    -- Metadata
    created_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_matches_date ON matches(match_date);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_signup_window ON matches(signup_open_date, signup_close_date);
CREATE INDEX idx_matches_created_by ON matches(created_by);

-- Constraints
ALTER TABLE matches ADD CONSTRAINT valid_signup_window 
    CHECK (signup_close_date > signup_open_date);
ALTER TABLE matches ADD CONSTRAINT valid_match_datetime 
    CHECK (match_date::timestamp + match_time > signup_close_date);
```

### 3.3 Signups Table
```sql
CREATE TABLE signups (
    signup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Priority status (set by coach)
    is_priority BOOLEAN DEFAULT false,
    priority_set_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    priority_set_at TIMESTAMP WITH TIME ZONE,
    
    -- Signup tracking
    signed_up_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    withdrawn_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN GENERATED ALWAYS AS (withdrawn_at IS NULL) STORED,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one active signup per player per match
    CONSTRAINT unique_active_signup UNIQUE (match_id, player_id, is_active)
);

-- Indexes
CREATE INDEX idx_signups_match ON signups(match_id);
CREATE INDEX idx_signups_player ON signups(player_id);
CREATE INDEX idx_signups_active ON signups(match_id, is_active);
CREATE INDEX idx_signups_priority ON signups(match_id, is_priority) WHERE is_priority = true;

-- Composite index for optimization queries
CREATE INDEX idx_signups_optimization ON signups(match_id, player_id, is_priority, is_active);
```

### 3.4 Selections Table
```sql
CREATE TABLE selections (
    selection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Selection metadata
    selected_by_optimization BOOLEAN DEFAULT true,
    manually_adjusted BOOLEAN DEFAULT false,
    position_assigned VARCHAR(10), -- 'GK', 'DEF', 'MID', 'FWD'
    
    -- Optimization details
    optimization_score DECIMAL(10, 4), -- Individual player's contribution to objective
    is_priority_selection BOOLEAN DEFAULT false,
    
    -- Tracking
    selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    selected_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT, -- Coach who ran optimization or made manual selection
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one selection per player per match
    CONSTRAINT unique_selection UNIQUE (match_id, player_id)
);

-- Indexes
CREATE INDEX idx_selections_match ON selections(match_id);
CREATE INDEX idx_selections_player ON selections(player_id);
CREATE INDEX idx_selections_optimization_flag ON selections(selected_by_optimization);
CREATE INDEX idx_selections_manual_flag ON selections(manually_adjusted);
```

### 3.5 Match_Performance Table
```sql
CREATE TABLE match_performance (
    performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Attendance
    attended BOOLEAN NOT NULL DEFAULT false,
    
    -- Performance metrics (nullable if player didn't attend)
    goals INTEGER DEFAULT 0 CHECK (goals >= 0),
    assists INTEGER DEFAULT 0 CHECK (assists >= 0),
    saves INTEGER DEFAULT 0 CHECK (saves >= 0), -- For goalkeepers
    clean_sheet BOOLEAN DEFAULT false, -- For goalkeepers
    yellow_cards INTEGER DEFAULT 0 CHECK (yellow_cards >= 0),
    red_cards INTEGER DEFAULT 0 CHECK (red_cards >= 0),
    minutes_played INTEGER CHECK (minutes_played >= 0 AND minutes_played <= 120),
    
    -- Position played (may differ from preferred)
    position_played VARCHAR(10),
    
    -- Player self-assessment (1-10 scale)
    self_rating INTEGER CHECK (self_rating >= 1 AND self_rating <= 10),
    
    -- Metadata
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one performance record per player per match
    CONSTRAINT unique_performance UNIQUE (match_id, player_id)
);

-- Indexes
CREATE INDEX idx_performance_match ON match_performance(match_id);
CREATE INDEX idx_performance_player ON match_performance(player_id);
CREATE INDEX idx_performance_attended ON match_performance(attended);
CREATE INDEX idx_performance_goals ON match_performance(goals) WHERE goals > 0;
```

### 3.6 System_Config Table
```sql
CREATE TABLE system_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initial configuration values
INSERT INTO system_config (config_key, config_value, description) VALUES
('default_min_players', '8', 'Default minimum players per match'),
('default_max_players', '12', 'Default maximum players per match'),
('default_optimization_weights', '{\"fairness\": 0.9, \"deficit\": 1.0, \"position_coverage\": -1.0, \"preferred_position\": -0.5}', 'Default weights for optimization objective function'),
('positions', '[\"GK\", \"DEF\", \"MID\", \"FWD\"]', 'Available field positions'),
('signup_reminder_hours', '24', 'Hours before signup closes to send reminder'),
('match_reminder_hours', '24', 'Hours before match to send reminder'),
('total_matches_season', '15', 'Total matches in current season (for fairness calculation)'),
('email_templates', '{\"schedule_release\": \"template_id_1\", \"signup_reminder\": \"template_id_2\"}', 'SendGrid template IDs');

-- Index
CREATE INDEX idx_config_updated ON system_config(updated_at);
```

### 3.7 Audit_Log Table (for admin tracking)
```sql
CREATE TABLE audit_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'GRANT_ACCESS'
    entity_type VARCHAR(50) NOT NULL, -- 'user', 'match', 'signup', 'selection'
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_log(created_at);
```

### 3.8 Database Views (for common queries)

```sql
-- View: Player statistics summary
CREATE VIEW player_statistics AS
SELECT 
    u.user_id,
    u.name,
    u.preferred_positions,
    COUNT(DISTINCT s.match_id) FILTER (WHERE s.is_active) as total_signups,
    COUNT(DISTINCT sel.match_id) as total_selected,
    COUNT(DISTINCT mp.match_id) FILTER (WHERE mp.attended) as total_played,
    COALESCE(SUM(mp.goals), 0) as total_goals,
    COALESCE(SUM(mp.assists), 0) as total_assists,
    COALESCE(SUM(mp.saves), 0) as total_saves,
    COALESCE(AVG(mp.self_rating), 0) as avg_rating,
    ROUND(
        COUNT(DISTINCT mp.match_id) FILTER (WHERE mp.attended)::numeric / 
        NULLIF(COUNT(DISTINCT s.match_id) FILTER (WHERE s.is_active), 0) * 100, 
        2
    ) as attendance_rate
FROM users u
LEFT JOIN signups s ON u.user_id = s.player_id
LEFT JOIN selections sel ON u.user_id = sel.player_id
LEFT JOIN match_performance mp ON u.user_id = mp.player_id
WHERE u.role = 'player' AND u.is_active = true
GROUP BY u.user_id, u.name, u.preferred_positions;

-- View: Match summary
CREATE VIEW match_summary AS
SELECT 
    m.match_id,
    m.match_date,
    m.match_time,
    m.location,
    m.status,
    COUNT(DISTINCT s.signup_id) FILTER (WHERE s.is_active) as total_signups,
    COUNT(DISTINCT s.signup_id) FILTER (WHERE s.is_active AND s.is_priority) as priority_signups,
    COUNT(DISTINCT sel.selection_id) as total_selected,
    COUNT(DISTINCT mp.performance_id) FILTER (WHERE mp.attended) as total_attended,
    m.min_players,
    m.max_players,
    CASE 
        WHEN COUNT(DISTINCT s.signup_id) FILTER (WHERE s.is_active) < m.min_players 
        THEN m.min_players - COUNT(DISTINCT s.signup_id) FILTER (WHERE s.is_active)
        ELSE 0 
    END as player_deficit
FROM matches m
LEFT JOIN signups s ON m.match_id = s.match_id
LEFT JOIN selections sel ON m.match_id = sel.match_id
LEFT JOIN match_performance mp ON m.match_id = mp.match_id
GROUP BY m.match_id;
```

---

## 4. API SPECIFICATION

### 4.1 Authentication Endpoints

#### POST /api/auth/register
**Description:** Register a new user account (admin-only for initial setup, then self-registration with approval)

**Request:**
```json
{
  "email": "player@example.com",
  "password": "SecurePass123!",
  "name": "John Doe",
  "preferredPositions": ["MID", "FWD"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-v4",
    "email": "player@example.com",
    "name": "John Doe",
    "role": "player",
    "preferredPositions": ["MID", "FWD"]
  },
  "message": "Registration successful. Please check your email for verification."
}
```

**Validation Rules:**
- Email: Valid format, unique in database
- Password: Min 8 chars, 1 uppercase, 1 number, 1 special char
- Name: 2-100 characters
- Preferred positions: Array of valid positions from system_config

---

#### POST /api/auth/login
**Description:** Authenticate user and receive JWT tokens

**Request:**
```json
{
  "email": "player@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "uuid-v4",
      "email": "player@example.com",
      "name": "John Doe",
      "role": "player",
      "preferredPositions": ["MID", "FWD"]
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 3600
    }
  }
}
```

**Error Response (401 Unauthorized):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

---

#### POST /api/auth/refresh
**Description:** Refresh access token using refresh token

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

---

#### POST /api/auth/logout
**Description:** Invalidate refresh token

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 4.2 Player Endpoints

#### GET /api/matches/upcoming
**Description:** Get list of upcoming matches available for signup

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `status` (optional): Filter by status (default: 'signup_open')
- `limit` (optional): Number of results (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "matchId": "uuid-v4",
        "matchDate": "2026-05-20",
        "matchTime": "18:00:00",
        "location": "City Sports Center",
        "matchType": "futsal",
        "signupCloseDate": "2026-05-19T12:00:00Z",
        "minPlayers": 8,
        "maxPlayers": 12,
        "currentSignups": 10,
        "userSignedUp": true,
        "userIsPriority": false,
        "signupDeadlinePassed": false
      }
    ],
    "pagination": {
      "total": 5,
      "limit": 20,
      "offset": 0
    }
  }
}
```

---

#### POST /api/signups
**Description:** Sign up for a match

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "matchId": "uuid-v4"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "signupId": "uuid-v4",
    "matchId": "uuid-v4",
    "playerId": "uuid-v4",
    "signedUpAt": "2026-05-14T15:37:57Z"
  },
  "message": "Successfully signed up for match"
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "SIGNUP_CLOSED",
    "message": "Signup window has closed for this match"
  }
}
```

**Error Response (409 Conflict):**
```json
{
  "success": false,
  "error": {
    "code": "ALREADY_SIGNED_UP",
    "message": "You are already signed up for this match"
  }
}
```

---

#### DELETE /api/signups/:signupId
**Description:** Withdraw from a match

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Successfully withdrawn from match"
}
```

**Error Response (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "code": "WITHDRAWAL_NOT_ALLOWED",
    "message": "Cannot withdraw after selection has been published"
  }
}
```

---

#### GET /api/players/:playerId/statistics
**Description:** Get personal statistics for a player

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `season` (optional): Filter by season (default: current)
- `matchId` (optional): Get stats for specific match

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "player": {
      "userId": "uuid-v4",
      "name": "John Doe",
      "preferredPositions": ["MID", "FWD"]
    },
    "seasonStats": {
      "totalSignups": 12,
      "totalSelected": 10,
      "totalPlayed": 9,
      "attendanceRate": 75.0,
      "totalGoals": 5,
      "totalAssists": 3,
      "avgRating": 7.2
    },
    "recentMatches": [
      {
        "matchId": "uuid-v4",
        "matchDate": "2026-05-10",
        "attended": true,
        "goals": 2,
        "assists": 1,
        "minutesPlayed": 60,
        "positionPlayed": "FWD",
        "selfRating": 8
      }
    ]
  }
}
```

---

#### PUT /api/players/:playerId/profile
**Description:** Update player profile (own profile only)

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "name": "John Doe Jr.",
  "preferredPositions": ["MID", "FWD", "DEF"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-v4",
    "name": "John Doe Jr.",
    "preferredPositions": ["MID", "FWD", "DEF"],
    "updatedAt": "2026-05-14T15:37:57Z"
  }
}
```

**Authorization:** User can only update their own profile unless admin

---

#### POST /api/matches/:matchId/performance
**Description:** Submit performance data after a match

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "attended": true,
  "goals": 2,
  "assists": 1,
  "saves": 0,
  "cleanSheet": false,
  "yellowCards": 0,
  "redCards": 0,
  "minutesPlayed": 60,
  "positionPlayed": "FWD",
  "selfRating": 8
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "performanceId": "uuid-v4",
    "matchId": "uuid-v4",
    "playerId": "uuid-v4",
    "submittedAt": "2026-05-14T15:37:57Z"
  },
  "message": "Performance data submitted successfully"
}
```

**Validation Rules:**
- Can only submit for matches where player was selected
- Can only submit after match completion
- All numeric fields must be non-negative
- Self-rating must be 1-10

---

### 4.3 Coach Endpoints

#### POST /api/matches
**Description:** Create a new match

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "matchDate": "2026-05-25",
  "matchTime": "18:00:00",
  "location": "City Sports Center",
  "matchType": "futsal",
  "signupOpenDate": "2026-05-15T00:00:00Z",
  "signupCloseDate": "2026-05-24T12:00:00Z",
  "minPlayers": 8,
  "maxPlayers": 12,
  "priorityEnabled": true,
  "optimizationWeights": {
    "fairness": 0.9,
    "deficit": 1.0,
    "positionCoverage": -1.0,
    "preferredPosition": -0.5
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "matchId": "uuid-v4",
    "matchDate": "2026-05-25",
    "matchTime": "18:00:00",
    "location": "City Sports Center",
    "status": "draft",
    "createdAt": "2026-05-14T15:37:57Z"
  }
}
```

**Validation Rules:**
- Match date must be in the future
- Signup close date must be before match date
- Min players must be > 0
- Max players must be >= min players
- Optimization weights must be numeric

**Authorization:** Role must be 'coach' or 'admin'

---

#### PUT /api/matches/:matchId
**Description:** Update match details

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "location": "Updated Location",
  "signupCloseDate": "2026-05-24T18:00:00Z",
  "status": "signup_open"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "matchId": "uuid-v4",
    "location": "Updated Location",
    "signupCloseDate": "2026-05-24T18:00:00Z",
    "status": "signup_open",
    "updatedAt": "2026-05-14T15:37:57Z"
  }
}
```

**Business Rules:**
- Cannot change match date/time if status is 'published' or 'completed'
- Cannot reopen signup if status is 'published'

---

#### GET /api/matches/:matchId/signups
**Description:** View all signups for a match

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "match": {
      "matchId": "uuid-v4",
      "matchDate": "2026-05-25",
      "matchTime": "18:00:00",
      "minPlayers": 8,
      "maxPlayers": 12
    },
    "signups": [
      {
        "signupId": "uuid-v4",
        "player": {
          "userId": "uuid-v4",
          "name": "John Doe",
          "preferredPositions": ["MID", "FWD"]
        },
        "isPriority": false,
        "signedUpAt": "2026-05-15T10:30:00Z",
        "historicalStats": {
          "matchesPlayed": 8,
          "matchesSignedUp": 12,
          "fairnessScore": 0.667
        }
      }
    ],
    "summary": {
      "totalSignups": 10,
      "prioritySignups": 2,
      "deficit": 0
    }
  }
}
```

**Authorization:** Role must be 'coach' or 'admin'

---

#### PUT /api/signups/:signupId/priority
**Description:** Toggle priority status for a player

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "isPriority": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "signupId": "uuid-v4",
    "isPriority": true,
    "prioritySetBy": "uuid-v4-coach",
    "prioritySetAt": "2026-05-14T15:37:57Z"
  }
}
```

**Authorization:** Role must be 'coach' or 'admin'

---

#### POST /api/matches/:matchId/optimize
**Description:** Run optimization model to select players

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "useCustomWeights": false,
  "customWeights": {
    "fairness": 0.9,
    "deficit": 1.0,
    "positionCoverage": -1.0,
    "preferredPosition": -0.5
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "optimizationId": "uuid-v4",
    "matchId": "uuid-v4",
    "status": "optimal",
    "objectiveValue": -12.45,
    "selectedPlayers": [
      {
        "playerId": "uuid-v4",
        "name": "John Doe",
        "preferredPositions": ["MID", "FWD"],
        "assignedPosition": "MID",
        "isPrioritySelection": false,
        "optimizationScore": -1.2
      }
    ],
    "summary": {
      "totalSelected": 10,
      "prioritySelected": 2,
      "deficit": 0,
      "positionCoverage": {
        "GK": 1,
        "DEF": 3,
        "MID": 4,
        "FWD": 2
      }
    },
    "warnings": []
  }
}
```

**Response (200 OK - with deficit):**
```json
{
  "success": true,
  "data": {
    "status": "optimal_with_deficit",
    "deficit": 2,
    "warnings": [
      "Insufficient signups: Need 2 more players. Consider recruiting external players."
    ]
  }
}
```

**Error Response (500 Internal Server Error):**
```json
{
  "success": false,
  "error": {
    "code": "OPTIMIZATION_FAILED",
    "message": "Optimization solver failed to find solution",
    "details": "Infeasible problem: constraints cannot be satisfied"
  }
}
```

**Business Logic:**
1. Fetch all active signups for the match
2. Retrieve historical data (matches played, matches signed up)
3. Get total matches from system_config
4. Send data to Julia optimization service
5. Store results in selections table
6. Return results with warnings if deficit exists

**Authorization:** Role must be 'coach' or 'admin'

---

#### PUT /api/matches/:matchId/selections
**Description:** Manually adjust player selections

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "selections": [
    {
      "playerId": "uuid-v4",
      "selected": true,
      "positionAssigned": "MID"
    },
    {
      "playerId": "uuid-v4-2",
      "selected": false
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "matchId": "uuid-v4",
    "updatedSelections": 2,
    "currentSelections": [
      {
        "selectionId": "uuid-v4",
        "playerId": "uuid-v4",
        "manuallyAdjusted": true,
        "positionAssigned": "MID"
      }
    ]
  }
}
```

**Business Rules:**
- Can only adjust before status is 'published'
- Total selections must be between min and max players
- Mark selections as manually_adjusted = true

**Authorization:** Role must be 'coach' or 'admin'

---

#### POST /api/matches/:matchId/publish
**Description:** Publish match selection and send email notifications

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "matchId": "uuid-v4",
    "status": "published",
    "publishedAt": "2026-05-14T15:37:57Z",
    "emailsSent": 10,
    "emailsFailed": 0
  },
  "message": "Match selection published and notifications sent"
}
```

**Business Logic:**
1. Validate that selections exist and meet min/max constraints
2. Update match status to 'published'
3. Send email to all selected players with match details
4. Log audit trail

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_SELECTIONS",
    "message": "Cannot publish: Only 7 players selected, minimum is 8"
  }
}
```

**Authorization:** Role must be 'coach' or 'admin'

---

#### GET /api/statistics/team
**Description:** Get team-wide statistics and analytics

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `season` (optional): Filter by season
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalMatches": 15,
      "completedMatches": 12,
      "upcomingMatches": 3,
      "averageAttendance": 9.5,
      "totalGoals": 45,
      "totalAssists": 32
    },
    "playerParticipation": [
      {
        "playerId": "uuid-v4",
        "name": "John Doe",
        "signups": 12,
        "selected": 10,
        "played": 9,
        "attendanceRate": 75.0,
        "fairnessScore": 0.667
      }
    ],
    "positionDistribution": {
      "GK": 12,
      "DEF": 36,
      "MID": 48,
      "FWD": 24
    },
    "priorityUsage": {
      "totalPrioritySelections": 24,
      "averagePriorityPerMatch": 2.0
    }
  }
}
```

**Authorization:** Role must be 'coach' or 'admin'

---

### 4.4 Admin Endpoints

#### GET /api/admin/users
**Description:** List all users with filtering

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `role` (optional): Filter by role
- `isActive` (optional): Filter by active status
- `search` (optional): Search by name or email
- `limit` (optional): Results per page (default: 50)
- `offset` (optional): Pagination offset

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "userId": "uuid-v4",
        "email": "player@example.com",
        "name": "John Doe",
        "role": "player",
        "isActive": true,
        "createdAt": "2026-01-15T10:00:00Z",
        "lastLogin": "2026-05-14T14:30:00Z"
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 50,
      "offset": 0
    }
  }
}
```

**Authorization:** Role must be 'admin'

---

#### POST /api/admin/users
**Description:** Create a new user (admin-initiated)

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "email": "newplayer@example.com",
  "password": "TempPass123!",
  "name": "Jane Smith",
  "role": "player",
  "preferredPositions": ["DEF"]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-v4",
    "email": "newplayer@example.com",
    "name": "Jane Smith",
    "role": "player",
    "temporaryPassword": true
  },
  "message": "User created. Temporary password sent via email."
}
```

**Authorization:** Role must be 'admin'

---

#### DELETE /api/admin/users/:userId
**Description:** Delete a user account

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User deleted successfully",
  "data": {
    "deletedUserId": "uuid-v4",
    "cascadeDeleted": {
      "signups": 15,
      "selections": 12,
      "performances": 10
    }
  }
}
```

**Business Rules:**
- Cannot delete own account
- Cascade deletes signups, selections, and performance data
- Audit log entry created

**Authorization:** Role must be 'admin'

---

#### PUT /api/admin/users/:userId/role
**Description:** Change user role

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request:**
```json
{
  "role": "coach"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid-v4",
    "previousRole": "player",
    "newRole": "coach",
    "updatedAt": "2026-05-14T15:37:57Z"
  }
}
```

**Business Rules:**
- Cannot change own role
- Audit log entry created
- Valid roles: 'player', 'coach', 'admin'

**Authorization:** Role must be 'admin'

---

#### GET /api/admin/system/health
**Description:** Get system health and monitoring data

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "database": {
      "status": "healthy",
      "size": "245 MB",
      "connections": 5,
      "maxConnections": 100
    },
    "api": {
      "uptime": "15d 6h 23m",
      "requestsToday": 1247,
      "averageResponseTime": "125ms",
      "errorRate": "0.2%"
    },
    "optimizationService": {
      "status": "healthy",
      "lastRun": "2026-05-14T14:30:00Z",
      "averageSolveTime": "2.3s",
      "failureRate": "0%"
    },
    "email": {
      "status": "healthy",
      "sentToday": 45,
      "quotaRemaining": 55,
      "failedToday": 0
    },
    "storage": {
      "databaseUsage": "49%",
      "bandwidthUsage": "32%"
    }
  }
}
```

**Authorization:** Role must be 'admin'

---

#### GET /api/admin/audit-log
**Description:** Retrieve audit log entries

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Query Parameters:**
- `userId` (optional): Filter by user
- `action` (optional): Filter by action type
- `entityType` (optional): Filter by entity type
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date
- `limit` (optional): Results per page (default: 100)
- `offset` (optional): Pagination offset

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "logId": "uuid-v4",
        "userId": "uuid-v4",
        "userName": "Admin User",
        "action": "GRANT_ACCESS",
        "entityType": "user",
        "entityId": "uuid-v4-2",
        "oldValues": {"role": "player"},
        "newValues": {"role": "coach"},
        "ipAddress": "192.168.1.1",
        "createdAt": "2026-05-14T15:37:57Z"
      }
    ],
    "pagination": {
      "total": 523,
      "limit": 100,
      "offset": 0
    }
  }
}
```

**Authorization:** Role must be 'admin'

---

### 4.5 Common Error Responses

All endpoints may return these standard error responses:

**401 Unauthorized:**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

**422 Validation Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

**429 Rate Limit:**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "requestId": "uuid-v4"
  }
}
```

---

## 5. OPTIMIZATION MODEL SPECIFICATION

### 5.1 Mathematical Formulation

Based on the Julia model provided, the optimization problem is formulated as follows:

#### Sets and Indices
- **I**: Set of players (i = 1, 2, ..., n)
- **J**: Set of matches (j = 1, 2, ..., m)
- **P**: Set of priority players (P ⊆ I)
- **POS**: Set of positions = {GK, DEF, MID, FWD}

#### Parameters
- **A[i,j]**: Binary matrix indicating if player i signed up for match j (1 if signed up, 0 otherwise)
- **spilledeK[i]**: Number of matches player i has played historically
- **tilmeldteK[i]**: Number of matches player i has signed up for historically
- **totalKampe**: Total number of matches in the season (constant, e.g., 15)
- **antalUdtagede[j]**: Target number of players to select for match j (typically equals minPlayers[j])
- **minPlayers[j]**: Minimum number of players required for match j
- **maxPlayers[j]**: Maximum number of players allowed for match j
- **preferredPos[i]**: Array of preferred positions for player i
- **w**: Weight for fairness calculation (default: 0.9)
- **R**: Reward coefficient for priority players (default: -1, negative for reward)
- **w_deficit**: Penalty weight for player deficit (default: totalKampe = 15)
- **w_position**: Reward weight for position coverage (default: -1.0)
- **w_preferred**: Reward weight for preferred position bonus (default: -0.5)

#### Decision Variables
- **x[i,j] ∈ {0,1}**: Binary variable, 1 if player i is selected for match j, 0 otherwise
- **y[i,j] ∈ {0,1}**: Binary variable, 1 if player i is a priority player selected for match j, 0 otherwise
- **d[j] ≥ 0**: Integer variable representing the deficit (shortage) of players for match j
- **pos_covered[j,p] ∈ {0,1}**: Binary variable, 1 if position p is covered in match j, 0 otherwise
- **pref_bonus[i,j] ∈ {0,1}**: Binary variable, 1 if player i is selected for match j in their preferred position

#### Objective Function

```
Minimize:
  Σ(i∈I, j∈J) measure[i] * x[i,j]                    [Fairness term]
  + w_deficit * Σ(j∈J) d[j]                          [Deficit penalty]
  + R * Σ(i∈P, j∈J) A[i,j] * y[i,j]                  [Priority reward]
  - w_position * Σ(j∈J, p∈POS) pos_covered[j,p]     [Position coverage reward]
  - w_preferred * Σ(i∈I, j∈J) pref_bonus[i,j]       [Preferred position bonus]

Where:
  measure[i] = (w * spilledeK[i] - (1 - w) * tilmeldteK[i]) / totalKampe
```

**Explanation of Objective Components:**

1. **Fairness Term**: Minimizes the weighted difference between matches played and matches signed up for. Players who have played more relative to their signups get lower priority.

2. **Deficit Penalty**: Heavily penalizes not meeting the minimum player requirement. The large weight (totalKampe) ensures this is prioritized.

3. **Priority Reward**: Negative coefficient (R = -1) rewards selecting priority players. Only applies to players marked as priority who signed up.

4. **Position Coverage Reward**: Rewards having at least one player for each position in each match.

5. **Preferred Position Bonus**: Additional reward for selecting players in their preferred positions.

#### Constraints

**1. Selection Constraint (Can only select signed-up players):**
```
x[i,j] ≤ A[i,j]    ∀ i ∈ I, j ∈ J
```

**2. Player Count Constraint (Meet target with deficit variable):**
```
Σ(i∈I) A[i,j] * x[i,j] + d[j] = antalUdtagede[j]    ∀ j ∈ J
```
*Note: This ensures exactly antalUdtagede[j] players are selected, using deficit d[j] if insufficient signups.*

**3. Maximum Players Constraint:**
```
Σ(i∈I) x[i,j] ≤ maxPlayers[j]    ∀ j ∈ J
```

**4. Minimum Players Constraint (soft via deficit):**
```
Σ(i∈I) x[i,j] ≥ minPlayers[j] - d[j]    ∀ j ∈ J
```

**5. Priority Player Linkage:**
```
y[i,j] ≤ x[i,j]    ∀ i ∈ I, j ∈ J
```
*Note: y[i,j] can only be 1 if x[i,j] is 1 (player is selected).*

**6. Priority Player Constraint (only for priority players):**
```
y[i,j] = 0    ∀ i ∉ P, j ∈ J
```

**7. Position Coverage Constraint:**
```
pos_covered[j,p] ≤ Σ(i: p ∈ preferredPos[i]) x[i,j]    ∀ j ∈ J, p ∈ POS
```
*Note: Position p is covered only if at least one player with that preferred position is selected.*

**8. Preferred Position Bonus Constraint:**
```
pref_bonus[i,j] ≤ x[i,j]    ∀ i ∈ I, j ∈ J
pref_bonus[i,j] = 1 if x[i,j] = 1 AND assignedPosition[i,j] ∈ preferredPos[i]
```
*Note: This requires position assignment logic, which can be handled post-optimization or via additional constraints.*

**9. Variable Domains:**
```
x[i,j] ∈ {0,1}    ∀ i ∈ I, j ∈ J
y[i,j] ∈ {0,1}    ∀ i ∈ I, j ∈ J
d[j] ∈ ℤ₊         ∀ j ∈ J
pos_covered[j,p] ∈ {0,1}    ∀ j ∈ J, p ∈ POS
pref_bonus[i,j] ∈ {0,1}    ∀ i ∈ I, j ∈ J
```

### 5.2 Implementation Approach

#### Recommended Solver
**Primary:** HiGHS (open-source, high-performance MIP solver)
- Free and open-source
- Excellent performance for small-to-medium problems
- Easy integration with JuMP.jl
- No licensing required

**Alternative:** GLPK (GNU Linear Programming Kit)
- Fully open-source
- Slower than HiGHS but reliable
- Good for testing and development

**Academic Option:** Gurobi (if academic license available)
- Superior performance for larger problems
- Free academic license
- Commercial use requires paid license

#### Julia Optimization Service Architecture

**Service Structure:**
```
optimization-service/
├── src/
│   ├── server.jl           # HTTP server using HTTP.jl
│   ├── optimizer.jl        # Core optimization logic
│   ├── data_parser.jl      # Parse JSON input
│   └── result_formatter.jl # Format optimization results
├── Project.toml            # Julia dependencies
├── Dockerfile              # Container definition
└── README.md
```

**Dependencies (Project.toml):**
```toml
[deps]
JuMP = "4076af6c-e467-56ae-b986-b466b2749572"
HiGHS = "87dc4568-4c63-4d18-b0c0-bb2238e4078b"
HTTP = "cd3eb016-35fb-5094-929b-558a96fad6f3"
JSON3 = "0f8b85d8-7281-11e9-16c2-39a750bddbf1"
```

**API Endpoint:**
```
POST /optimize
Content-Type: application/json

Request Body:
{
  "players": [
    {
      "playerId": "uuid-v4",
      "matchesPlayed": 8,
      "matchesSignedUp": 12,
      "preferredPositions": ["MID", "FWD"]
    }
  ],
  "matches": [
    {
      "matchId": "uuid-v4",
      "minPlayers": 8,
      "maxPlayers": 12,
      "signups": ["uuid-v4-player1", "uuid-v4-player2"],
      "priorityPlayers": ["uuid-v4-player1"]
    }
  ],
  "config": {
    "totalMatches": 15,
    "weights": {
      "fairness": 0.9,
      "deficit": 15.0,
      "positionCoverage": -1.0,
      "preferredPosition": -0.5,
      "priority": -1.0
    }
  }
}

Response (Success):
{
  "status": "optimal",
  "objectiveValue": -12.45,
  "solveTime": 2.3,
  "selections": [
    {
      "matchId": "uuid-v4",
      "selectedPlayers": [
        {
          "playerId": "uuid-v4",
          "isPriority": false,
          "score": -1.2,
          "suggestedPosition": "MID"
        }
      ],
      "deficit": 0,
      "positionCoverage": {
        "GK": true,
        "DEF": true,
        "MID": true,
        "FWD": true
      }
    }
  ]
}

Response (Infeasible):
{
  "status": "infeasible",
  "message": "No feasible solution found. Constraints cannot be satisfied.",
  "details": "Insufficient signups for match uuid-v4"
}
```

#### Integration Pattern

**Backend API → Optimization Service Flow:**

1. **API receives optimization request** from coach
2. **Fetch data from database:**
   - Active signups for target matches
   - Player historical data (spilledeK, tilmeldteK)
   - Priority player flags
   - System configuration (totalKampe, weights)
3. **Transform data to optimization format:**
   - Build A matrix (signups)
   - Build measure array
   - Identify priority player set P
4. **Send HTTP POST to Julia service** with JSON payload
5. **Julia service:**
   - Parse JSON input
   - Build JuMP model
   - Solve using HiGHS
   - Format results as JSON
   - Return HTTP response
6. **API processes results:**
   - Store selections in database
   - Mark selections as `selected_by_optimization = true`
   - Calculate position assignments
   - Return to frontend

#### Error Handling & Fallback

**Optimization Service Failures:**
- **Timeout (>30s):** Return error to user, suggest reducing problem size
- **Infeasible:** Return specific message about constraint violations
- **Service Unavailable:** Retry with exponential backoff (3 attempts)
- **Solver Error:** Log error, notify admin, suggest manual selection

**Fallback Strategy:**
If optimization service is down:
1. Allow coach to proceed with manual selection only
2. Display warning message
3. Log incident for admin review
4. Send alert email to admin

#### Performance Optimization

**Expected Problem Size:**
- Players: ~20-30
- Matches per optimization run: 1-5
- Variables: ~100-150
- Constraints: ~50-100

**Solve Time Expectations:**
- HiGHS: <5 seconds for typical problems
- GLPK: <15 seconds for typical problems
- Gurobi: <2 seconds for typical problems

**Optimization Tips:**
- Use warm start if re-optimizing with minor changes
- Cache player historical data to reduce database queries
- Batch optimize multiple matches when possible
- Set solver time limit (30 seconds) to prevent hanging

---

## 6. USER INTERFACE SPECIFICATIONS

### 6.1 Player Dashboard

**Route:** `/player/dashboard`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  Football Team Manager        [Profile] [Logout]│
├─────────────────────────────────────────────────────────┤
│  Dashboard  |  Matches  |  Statistics  |  Profile       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Welcome back, John Doe!                                 │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Quick Stats                                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │  │
│  │  │ Matches  │ │ Upcoming │ │Attendance│         │  │
│  │  │  Played  │ │ Matches  │ │   Rate   │         │  │
│  │  │    9     │ │    3     │ │   75%    │         │  │
│  │  └──────────┘ └──────────┘ └──────────┘         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Upcoming Matches                                 │  │
│  │                                                    │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │ 📅 May 20, 2026 - 18:00                    │  │  │
│  │  │ 📍 City Sports Center (Futsal)             │  │  │
│  │  │ 👥 10/12 signed up                         │  │  │
│  │  │ ⏰ Signup closes: May 19, 12:00            │  │  │
│  │  │                                             │  │  │
│  │  │ [✓ Signed Up]  [View Details]              │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │                                                    │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │ 📅 May 25, 2026 - 19:30                    │  │  │
│  │  │ 📍 Park Field (7-player)                   │  │  │
│  │  │ 👥 6/10 signed up                          │  │  │
│  │  │ ⏰ Signup closes: May 24, 18:00            │  │  │
│  │  │                                             │  │  │
│  │  │ [Sign Up]  [View Details]                  │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Components:**

1. **Navigation Bar**
   - Logo (left)
   - Menu items: Dashboard, Matches, Statistics, Profile
   - User profile dropdown (right): Settings, Logout

2. **Quick Stats Widget**
   - Three cards displaying:
     - Total matches played this season
     - Number of upcoming matches (signed up)
     - Attendance rate percentage
   - Visual: Card layout with icons and large numbers

3. **Upcoming Matches List**
   - Card-based layout for each match
   - Information displayed:
     - Date and time (with calendar icon)
     - Location and match type (with location pin icon)
     - Current signup count vs. max players (with people icon)
     - Signup deadline (with clock icon)
   - Action buttons:
     - "Signed Up" (green, disabled) if already signed up
     - "Sign Up" (blue, clickable) if not signed up
     - "Withdraw" (red) if signed up and deadline not passed
     - "View Details" (secondary button)
   - Visual indicator: Green checkmark if user is signed up

**Interactions:**

1. **Sign Up Button Click:**
   - Show confirmation modal: "Sign up for [Match Name]?"
   - On confirm: API call to POST /api/signups
   - On success: Button changes to "Signed Up", show success toast
   - On error: Show error message

2. **Withdraw Button Click:**
   - Show warning modal: "Are you sure you want to withdraw? This may affect team planning."
   - On confirm: API call to DELETE /api/signups/:id
   - On success: Button changes to "Sign Up", show info toast
   - On error: Show error message

3. **View Details Click:**
   - Expand card to show:
     - Full match details
     - List of signed-up players (if published)
     - Map/directions to location
     - Weather forecast (if available)

**Responsive Design:**
- Desktop: 3-column layout for stats, 2-column for matches
- Tablet: 2-column layout for stats, 1-column for matches
- Mobile: Single column, stacked cards

---

## 7. SECURITY & AUTHENTICATION

### 7.1 Authentication Strategy

**Technology:** Supabase Auth (built on PostgreSQL + JWT)

**Authentication Flow:**

1. **Registration:**
   - User submits email + password via `/api/auth/register`
   - Backend validates input (email format, password strength)
   - Supabase Auth creates user account
   - Verification email sent (optional, can be disabled for internal team)
   - User record created in `users` table with role = 'player'
   - Return success message

2. **Login:**
   - User submits credentials via `/api/auth/login`
   - Supabase Auth validates credentials
   - On success:
     - Generate access token (JWT, 1-hour expiry)
     - Generate refresh token (7-day expiry)
     - Update `last_login` timestamp
     - Return tokens + user profile
   - On failure: Return 401 Unauthorized

3. **Token Refresh:**
   - Client detects access token expiry (via 401 response)
   - Client sends refresh token to `/api/auth/refresh`
   - Backend validates refresh token
   - Generate new access token
   - Return new access token

4. **Logout:**
   - Client sends logout request with access token
   - Backend invalidates refresh token in Supabase
   - Client clears tokens from storage

**Password Requirements:**
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*)
- Cannot contain email address
- Cannot be common password (check against list)

**Session Management:**
- Access token stored in memory (React state)
- Refresh token stored in httpOnly cookie (secure, sameSite=strict)
- Automatic token refresh on API 401 responses
- Session timeout: 7 days (refresh token expiry)
- Concurrent sessions: Allowed (max 3 devices)

**Password Reset:**
1. User requests reset via email
2. Backend sends reset link with token (1-hour expiry)
3. User clicks link, redirected to reset page
4. User submits new password
5. Backend validates token and updates password
6. All existing sessions invalidated

---

### 7.2 Authorization Matrix

**Role-Based Access Control (RBAC):**

| Resource              | Player | Coach | Admin |
|-----------------------|--------|-------|-------|
| **Users**             |        |       |       |
| View own profile      | ✓      | ✓     | ✓     |
| Edit own profile      | ✓      | ✓     | ✓     |
| View all users        | ✗      | ✓     | ✓     |
| Create user           | ✗      | ✗     | ✓     |
| Edit other users      | ✗      | ✗     | ✓     |
| Delete users          | ✗      | ✗     | ✓     |
| Change user roles     | ✗      | ✗     | ✓     |
| **Matches**           |        |       |       |
| View upcoming matches | ✓      | ✓     | ✓     |
| View match details    | ✓      | ✓     | ✓     |
| Create matches        | ✗      | ✓     | ✓     |
| Edit matches          | ✗      | ✓     | ✓     |
| Delete matches        | ✗      | ✓     | ✓     |
| **Signups**           |        |       |       |
| Sign up for match     | ✓      | ✓     | ✓     |
| Withdraw from match   | ✓      | ✓     | ✓     |
| View all signups      | ✗      | ✓     | ✓     |
| Set priority status   | ✗      | ✓     | ✓     |
| **Selections**        |        |       |       |
| View own selection    | ✓      | ✓     | ✓     |
| View all selections   | ✗      | ✓     | ✓     |
| Run optimization      | ✗      | ✓     | ✓     |
| Manual adjustments    | ✗      | ✓     | ✓     |
| Publish selection     | ✗      | ✓     | ✓     |
| **Performance**       |        |       |       |
| Submit own performance| ✓      | ✓     | ✓     |
| Edit own performance  | ✓      | ✓     | ✓     |
| View all performance  | ✗      | ✓     | ✓     |
| Edit others' performance| ✗    | ✓     | ✓     |
| **Statistics**        |        |       |       |
| View own statistics   | ✓      | ✓     | ✓     |
| View team statistics  | ✗      | ✓     | ✓     |
| Export statistics     | ✗      | ✓     | ✓     |
| **Admin Functions**   |        |       |       |
| View system health    | ✗      | ✗     | ✓     |
| View audit log        | ✗      | ✗     | ✓     |
| Modify configuration  | ✗      | ✗     | ✓     |
| Database management   | ✗      | ✗     | ✓     |

---

### 7.3 Data Protection

#### Encryption

**At Rest:**
- Database encryption: Supabase provides AES-256 encryption at rest (automatic)
- Sensitive fields (if any): Additional application-level encryption using `crypto` library
- Backup encryption: Automatic via Supabase

**In Transit:**
- HTTPS/TLS 1.3 enforced for all API requests
- Certificate: Automatic via Vercel/Railway (Let's Encrypt)
- HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`

**Password Storage:**
- Hashing algorithm: bcrypt (via Supabase Auth)
- Salt rounds: 10
- Never store plaintext passwords
- Password reset tokens: SHA-256 hashed, 1-hour expiry

#### Input Validation & Sanitization

**Backend Validation (Zod schemas):**
- All user inputs validated against strict schemas
- Type checking and format validation
- Range checks for numeric values
- Enum validation for categorical fields

**SQL Injection Prevention:**
- Use parameterized queries (Prisma ORM)
- Never concatenate user input into SQL strings

**XSS Protection:**
- Content Security Policy (CSP) header
- React automatically escapes JSX content
- Sanitize HTML if rendering user-generated content (use DOMPurify)
- Validate and sanitize all user inputs on backend

**CSRF Protection:**
- SameSite cookie attribute: `SameSite=Strict`
- CSRF tokens for state-changing operations (if not using JWT in headers)
- Double-submit cookie pattern

**Rate Limiting:**
- General API rate limit: 100 requests per 15 minutes
- Authentication endpoints: 5 attempts per 15 minutes
- Exponential backoff for retries

**CORS Configuration:**
- Only allow frontend domain
- Allow credentials (cookies)
- Whitelist specific HTTP methods

---

## 8. NOTIFICATION SYSTEM

### 8.1 Email Templates

**Technology:** SendGrid Dynamic Templates (or Resend)

**Template 1: Schedule Release**
```
Subject: You're selected for {{matchDate}} match!

Hi {{playerName}},

Great news! You've been selected to play in the upcoming match:

📅 Date: {{matchDate}}
⏰ Time: {{matchTime}}
📍 Location: {{matchLocation}}
⚽ Type: {{matchType}}

Your assigned position: {{assignedPosition}}

Please confirm your attendance by clicking the link below:
[Confirm Attendance]

If you cannot attend, please notify the coach as soon as possible.

See you on the field!

---
Football Team Manager
[View Match Details] | [Update Profile]
```

**Template 2: Signup Reminder**
```
Subject: Reminder: Signup closes soon for {{matchDate}} match

Hi {{playerName}},

This is a friendly reminder that signup for the following match closes in 24 hours:

📅 Date: {{matchDate}}
⏰ Time: {{matchTime}}
📍 Location: {{matchLocation}}

Current signups: {{currentSignups}}/{{maxPlayers}}

Don't miss out! Sign up now:
[Sign Up Now]

---
Football Team Manager
```

**Template 3: Match Reminder**
```
Subject: Match tomorrow: {{matchDate}} at {{matchTime}}

Hi {{playerName}},

Just a reminder about tomorrow's match:

📅 Date: {{matchDate}}
⏰ Time: {{matchTime}}
📍 Location: {{matchLocation}}
⚽ Type: {{matchType}}

Your position: {{assignedPosition}}

Please arrive 15 minutes early for warm-up.

[Get Directions] | [View Team Roster]

See you there!

---
Football Team Manager
```

### 8.2 Notification Triggers

**Trigger Details:**

**1. Selection Published**
- **Trigger:** Coach clicks "Publish Selection"
- **Recipients:** All selected players
- **Template:** Schedule Release
- **Timing:** Immediate
- **Retry:** 3 attempts with exponential backoff

**2. Signup Window Opened**
- **Trigger:** Match status changes to 'signup_open'
- **Recipients:** All active players
- **Template:** Signup Reminder (modified for opening)
- **Timing:** Immediate
- **Batch:** Send in batches of 50 to avoid rate limits

**3. Signup Closing Soon**
- **Trigger:** Scheduled job (cron) 24 hours before signup closes
- **Recipients:** Players who haven't signed up yet
- **Template:** Signup Reminder
- **Timing:** 24 hours before deadline
- **Condition:** Only if signup count < max players

**4. Match Reminder**
- **Trigger:** Scheduled job (cron) 24 hours before match
- **Recipients:** Selected players
- **Template:** Match Reminder
- **Timing:** 24 hours before match
- **Condition:** Only if match status is 'published'

**5. Player Withdrawal After Selection**
- **Trigger:** Player withdraws after being selected
- **Recipients:** Coach
- **Template:** Admin Alert (modified)
- **Timing:** Immediate
- **Action:** Coach needs to find replacement

**6. Optimization Deficit Warning**
- **Trigger:** Optimization completes with deficit > 0
- **Recipients:** Coach
- **Template:** Admin Alert
- **Timing:** Immediate
- **Action:** Coach needs to recruit external players

**7. System Error Alert**
- **Trigger:** Critical error (database down, optimization service failure)
- **Recipients:** Admin
- **Template:** Admin Alert
- **Timing:** Immediate
- **Severity:** High

---

## 9. TESTING STRATEGY

### 9.1 Unit Tests

**Framework:** Jest + React Testing Library (frontend), Jest + Supertest (backend)

**Coverage Target:** 80% code coverage

**Backend Unit Tests:**

**1. Optimization Model Correctness**
- Test selection of exactly min players when signups equal min
- Test priority player prioritization when enabled
- Test handling of insufficient signups with deficit
- Test position coverage when possible
- Test fairness scoring calculation

**2. API Endpoint Validation**
- Test match creation with valid data
- Test rejection of invalid match data
- Test authorization checks
- Test input validation

**3. Database Query Performance**
- Test query execution time
- Test index effectiveness
- Test connection pooling

**Frontend Unit Tests:**

**1. Component Rendering**
- Test match card rendering
- Test signup button functionality
- Test form validation
- Test error handling

**2. State Management**
- Test context provider
- Test state updates
- Test side effects

**3. API Integration**
- Test API call handling
- Test error responses
- Test loading states

### 9.2 Integration Tests

**1. End-to-End User Flows**
- Test signup → optimization → selection → publish flow
- Test player signup and withdrawal
- Test performance data submission

**2. Authentication and Authorization**
- Test login/logout flow
- Test role-based access control
- Test token refresh

**3. Email Delivery**
- Test email queue
- Test template rendering
- Test retry logic

### 9.3 Test Data

**Sample Data:**
- 20-30 player profiles with varied positions and participation history
- 15 matches with different min/max constraints
- Edge cases: no signups, all priority, insufficient players

---

## 10. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2)
- Database schema implementation
- Authentication system
- Basic API endpoints (CRUD for users, matches)

### Phase 2: Core Features (Week 3-4)
- Signup system
- Player dashboard
- Coach match management

### Phase 3: Optimization (Week 5-6)
- Optimization model integration
- Selection interface
- Manual adjustment capability

### Phase 4: Statistics & Polish (Week 7-8)
- Statistics dashboards
- Email notifications
- Admin panel
- UI/UX refinements

### Phase 5: Testing & Deployment (Week 9-10)
- Comprehensive testing
- Performance optimization
- Production deployment
- Documentation

---

## 11. CONFIGURATION & EXTENSIBILITY

### 11.1 Configurable Parameters
- Min/max players per match (global defaults + per-match override)
- Optimization weights (fairness, deficit, position coverage, preferred position)
- Signup window defaults
- Email templates
- Positions list (allow custom positions)

### 11.2 Future Enhancements
- Mobile app (React Native)
- Real-time notifications (WebSockets)
- Advanced analytics (ML-based performance prediction)
- Multi-team support
- Integration with external calendars

---

## 12. DOCUMENTATION REQUIREMENTS
- API documentation (OpenAPI/Swagger)
- User guides (player, coach, admin)
- Deployment guide
- Database migration scripts
- Troubleshooting guide

---

## SPECIFICATION REVIEW CHECKLIST

### ✅ Validation Against Source Documents

**Completeness Verification:**
- ✓ All user requirements from the detailed specification document have been incorporated
- ✓ Julia optimization model has been translated into mathematical formulation
- ✓ All three user roles (player, coach, admin) with their specific requirements are covered
- ✓ Linear programming optimization with fairness, priority weighting, and position coverage is specified
- ✓ Email notification system with multiple triggers is detailed
- ✓ Statistics tracking and reporting for individual and team performance is included
- ✓ Free cloud services (Supabase, Vercel, Railway, SendGrid) are recommended throughout

**Optimization Model Validation:**
- ✓ Objective function includes fairness term (spilledeK vs tilmeldteK weighting)
- ✓ Deficit penalty for insufficient players is included
- ✓ Priority player reward mechanism is specified
- ✓ Position coverage reward has been added (as requested)
- ✓ Preferred position bonus has been added (as requested)
- ✓ All constraints from Julia model are mathematically formulated
- ✓ HiGHS solver integration is specified as primary option

**User Interface Alignment:**
- ✓ Player interface: Sign-up page, overview page, statistics page
- ✓ Coach interface: Match management, player selection with optimization, statistics
- ✓ Admin interface: User management, system health monitoring, audit log
- ✓ Manual override capability for coach selections
- ✓ Email notifications for schedule release and reminders

---

### 📋 Assumptions Made (Where Requirements Were Ambiguous)

1. **Optimization Frequency:** Assumed coach runs optimization once per match signup period, not continuously. Can be modified to support multiple optimization runs.

2. **Position Assignment:** Assumed position assignment is done post-optimization based on preferred positions. Could be integrated into optimization model for more precision.

3. **External Player Handling:** Assumed external players (recruited when deficit exists) are not tracked in system. Could be extended to track them.

4. **Season Definition:** Assumed season is calendar-based (e.g., 2026 season). Could be made configurable.

5. **Email Delivery:** Assumed SendGrid is acceptable; Resend is offered as alternative with similar free tier.

6. **Database Scaling:** Assumed team size of 20-30 players and ~50 matches/season. Schema can be optimized for larger scale if needed.

7. **Real-Time Updates:** Assumed polling-based updates are acceptable. WebSocket support can be added for real-time notifications.

8. **Multi-Team Support:** Assumed single team per instance. Multi-team support can be added in future phases.

---

### ⚠️ Critical Implementation Risks & Mitigation Strategies

**Risk 1: Optimization Service Unavailability**
- **Impact:** Coach cannot run optimization, must resort to manual selection
- **Mitigation:** 
  - Implement fallback to manual selection mode
  - Set up monitoring and alerting for service health
  - Implement retry logic with exponential backoff
  - Document manual selection process for coaches

**Risk 2: Insufficient Email Quota**
- **Impact:** Notifications not sent to players, causing confusion
- **Mitigation:**
  - Monitor SendGrid quota usage in admin dashboard
  - Implement email queue with retry logic
  - Set up alerts when quota reaches 80%
  - Provide fallback SMTP option
  - Consider batch sending during off-peak hours

**Risk 3: Database Performance Degradation**
- **Impact:** Slow API responses, poor user experience
- **Mitigation:**
  - Implement comprehensive indexing strategy
  - Use database views for complex queries
  - Implement caching layer (Redis) for frequently accessed data
  - Monitor query performance with slow query logs
  - Plan for database optimization/migration if team grows

**Risk 4: Fairness Algorithm Manipulation**
- **Impact:** Coach could manipulate priority flags to favor certain players
- **Mitigation:**
  - Implement audit logging for all priority changes
  - Provide transparency in fairness scoring to coach
  - Allow admin to review and override coach decisions
  - Generate fairness reports for team review

**Risk 5: Data Loss or Corruption**
- **Impact:** Loss of match history, player statistics, or selections
- **Mitigation:**
  - Implement automated daily backups (Supabase provides this)
  - Test backup restoration procedures regularly
  - Implement transaction-level consistency checks
  - Maintain audit log of all data modifications
  - Implement soft deletes for critical data

---

### ❓ Questions for Development Team to Clarify with Stakeholders

**Question 1: Position Assignment Logic**
- Should position assignment be part of the optimization model (more complex) or post-optimization based on preferred positions (simpler)?
- Should players be able to play multiple positions, and if so, how should this affect fairness scoring?

**Question 2: External Player Tracking**
- When a deficit exists and external players are recruited, should they be tracked in the system for future fairness calculations?
- Should external players have different fairness weights than regular team members?

**Question 3: Fairness Weighting Preferences**
- The current fairness weight (w=0.9) heavily favors matches played over matches signed up. Is this the desired behavior?
- Should fairness weighting be adjustable by the coach per match, or should it be fixed globally?

**Question 4: Priority Player Constraints**
- Should there be a maximum number of priority players per match (e.g., max 3)?
- Should priority status be permanent for a player or match-specific?

**Question 5: Performance Data Validation**
- Who should be able to submit performance data? Only players, or also coaches?
- Should there be a deadline for submitting performance data after a match?

---

**Document Prepared By:** AI Assistant (Solaria)  
**Date:** May 14, 2026  
**Status:** Ready for Development Team Review  
**Next Steps:** Present to development team, gather feedback, begin Phase 1 implementation
