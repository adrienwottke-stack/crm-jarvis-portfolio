-- Owner-gebundene Spotify-OAuth-Verbindung fuer den lokalen Jarvis-Smoke-Test.
-- Refresh-Tokens werden ausschliesslich verschluesselt abgelegt; Audio,
-- Geraete, Track-Historien und Zugriffstokens gehoeren nicht in diese Tabellen.
CREATE TABLE "SpotifyConnection" (
    "userId" TEXT NOT NULL,
    "refreshTokenCipher" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "lastErrorCode" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyConnection_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "SpotifyOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotifyOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpotifyOAuthState_stateHash_key" ON "SpotifyOAuthState"("stateHash");
CREATE INDEX "SpotifyOAuthState_userId_expiresAt_idx" ON "SpotifyOAuthState"("userId", "expiresAt");

ALTER TABLE "SpotifyConnection"
  ADD CONSTRAINT "SpotifyConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpotifyOAuthState"
  ADD CONSTRAINT "SpotifyOAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
