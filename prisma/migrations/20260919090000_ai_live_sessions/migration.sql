-- Jarvis Live: only short-lived session control data. No audio, transcript,
-- prompt or provider event payload is persisted in this table.

CREATE TABLE "AiLiveSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeKey" TEXT,
    "clientSessionId" TEXT NOT NULL,
    "providerSessionRef" TEXT,
    "usageId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiLiveSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiLiveSession_activeKey_key" ON "AiLiveSession"("activeKey");
CREATE UNIQUE INDEX "AiLiveSession_userId_clientSessionId_key"
ON "AiLiveSession"("userId", "clientSessionId");
CREATE INDEX "AiLiveSession_userId_status_expiresAt_idx"
ON "AiLiveSession"("userId", "status", "expiresAt");
CREATE INDEX "AiLiveSession_conversationId_idx" ON "AiLiveSession"("conversationId");

ALTER TABLE "AiLiveSession"
ADD CONSTRAINT "AiLiveSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiLiveSession"
ADD CONSTRAINT "AiLiveSession_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
