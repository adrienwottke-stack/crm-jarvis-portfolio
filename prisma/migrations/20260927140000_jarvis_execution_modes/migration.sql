CREATE TYPE "AiExecutionMode" AS ENUM ('READ_ONLY', 'CONFIRM', 'AUTONOMOUS');
ALTER TABLE "AiConversation" ADD COLUMN "executionMode" "AiExecutionMode" NOT NULL DEFAULT 'CONFIRM', ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiRequest" ADD COLUMN "executionMode" "AiExecutionMode";
