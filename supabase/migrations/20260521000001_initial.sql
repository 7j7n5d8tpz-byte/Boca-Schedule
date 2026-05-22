-- ============================================================
-- Boca Schedule – Initial Schema
-- ============================================================

-- Users
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'coach', 'admin')),
    preferred_positions TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Matches
CREATE TABLE matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_date DATE NOT NULL,
    match_time TIME NOT NULL,
    location VARCHAR(200) NOT NULL,
    match_type VARCHAR(20) NOT NULL CHECK (match_type IN ('futsal', '7-player', '11-player')),
    signup_open_date TIMESTAMPTZ NOT NULL,
    signup_close_date TIMESTAMPTZ NOT NULL,
    min_players INTEGER NOT NULL CHECK (min_players > 0),
    max_players INTEGER NOT NULL CHECK (max_players >= min_players),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'signup_open', 'signup_closed', 'optimized', 'published', 'completed')),
    priority_enabled BOOLEAN DEFAULT true,
    optimization_weights JSONB DEFAULT '{"fairness": 0.9, "deficit": 1.0, "position_coverage": -1.0, "preferred_position": -0.5}'::jsonb,
    created_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT valid_signup_window CHECK (signup_close_date > signup_open_date)
);

CREATE INDEX idx_matches_date ON matches(match_date);
CREATE INDEX idx_matches_status ON matches(status);

-- Signups
CREATE TABLE signups (
    signup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    is_priority BOOLEAN DEFAULT false,
    priority_set_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    priority_set_at TIMESTAMPTZ,
    signed_up_at TIMESTAMPTZ DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Computed column helper: is_active
ALTER TABLE signups ADD COLUMN is_active BOOLEAN GENERATED ALWAYS AS (withdrawn_at IS NULL) STORED;

CREATE INDEX idx_signups_match ON signups(match_id);
CREATE INDEX idx_signups_player ON signups(player_id);
CREATE INDEX idx_signups_active ON signups(match_id, is_active);

-- Selections
CREATE TABLE selections (
    selection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    selected_by_optimization BOOLEAN DEFAULT true,
    manually_adjusted BOOLEAN DEFAULT false,
    position_assigned VARCHAR(10),
    optimization_score DECIMAL(10, 4),
    is_priority_selection BOOLEAN DEFAULT false,
    selected_at TIMESTAMPTZ DEFAULT NOW(),
    selected_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_selection UNIQUE (match_id, player_id)
);

CREATE INDEX idx_selections_match ON selections(match_id);
CREATE INDEX idx_selections_player ON selections(player_id);

-- Match Performance
CREATE TABLE match_performance (
    performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    attended BOOLEAN NOT NULL DEFAULT false,
    goals INTEGER DEFAULT 0 CHECK (goals >= 0),
    assists INTEGER DEFAULT 0 CHECK (assists >= 0),
    saves INTEGER DEFAULT 0 CHECK (saves >= 0),
    clean_sheet BOOLEAN DEFAULT false,
    yellow_cards INTEGER DEFAULT 0 CHECK (yellow_cards >= 0),
    red_cards INTEGER DEFAULT 0 CHECK (red_cards >= 0),
    minutes_played INTEGER CHECK (minutes_played >= 0 AND minutes_played <= 120),
    position_played VARCHAR(10),
    self_rating INTEGER CHECK (self_rating >= 1 AND self_rating <= 10),
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_performance UNIQUE (match_id, player_id)
);

CREATE INDEX idx_performance_match ON match_performance(match_id);
CREATE INDEX idx_performance_player ON match_performance(player_id);

-- System Config
CREATE TABLE system_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_config (config_key, config_value, description) VALUES
('default_min_players', '8', 'Default minimum players per match'),
('default_max_players', '12', 'Default maximum players per match'),
('positions', '["GK", "DEF", "MID", "FWD"]', 'Available field positions'),
('total_matches_season', '15', 'Total matches in current season'),
('signup_reminder_hours', '24', 'Hours before signup closes to send reminder'),
('match_reminder_hours', '24', 'Hours before match to send reminder');

-- Audit Log
CREATE TABLE audit_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_timestamp ON audit_log(created_at);

-- ============================================================
-- Views
-- ============================================================

CREATE VIEW player_statistics AS
WITH perf AS (
    SELECT player_id,
        COUNT(*) FILTER (WHERE attended)  AS total_played,
        COALESCE(SUM(goals), 0)           AS total_goals,
        COALESCE(SUM(assists), 0)         AS total_assists,
        COALESCE(SUM(saves), 0)           AS total_saves,
        AVG(self_rating)                  AS avg_rating
    FROM match_performance
    GROUP BY player_id
),
sigs AS (
    SELECT player_id, COUNT(*) FILTER (WHERE is_active) AS total_signups
    FROM signups
    GROUP BY player_id
),
sels AS (
    SELECT player_id, COUNT(*) AS total_selected
    FROM selections
    GROUP BY player_id
)
SELECT
    u.user_id,
    u.name,
    u.preferred_positions,
    COALESCE(sigs.total_signups, 0)  AS total_signups,
    COALESCE(sels.total_selected, 0) AS total_selected,
    COALESCE(perf.total_played, 0)   AS total_played,
    COALESCE(perf.total_goals, 0)    AS total_goals,
    COALESCE(perf.total_assists, 0)  AS total_assists,
    COALESCE(perf.total_saves, 0)    AS total_saves,
    COALESCE(perf.avg_rating, 0)     AS avg_rating,
    ROUND(
        COALESCE(perf.total_played, 0)::numeric /
        NULLIF(COALESCE(sigs.total_signups, 0), 0)::numeric * 100,
        2
    ) AS attendance_rate
FROM users u
LEFT JOIN sigs ON u.user_id = sigs.player_id
LEFT JOIN sels ON u.user_id = sels.player_id
LEFT JOIN perf ON u.user_id = perf.player_id
WHERE u.role = 'player' AND u.is_active = true;
