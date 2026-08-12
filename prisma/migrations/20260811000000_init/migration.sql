-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NEVER_SYNCED', 'SYNCING', 'SYNCED', 'ERROR');

-- CreateEnum
CREATE TYPE "OptimizationMode" AS ENUM ('SUGGESTIONS', 'APPROVAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ENABLED', 'PAUSED', 'REMOVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('EXACT', 'PHRASE', 'BROAD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SearchTermStatus" AS ENUM ('NONE', 'ADDED', 'EXCLUDED', 'ADDED_EXCLUDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SearchTermIntent" AS ENUM ('HIGH_INTENT', 'MEDIUM_INTENT', 'LOW_INTENT', 'IRRELEVANT', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "AdVariantStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "MetricLevel" AS ENUM ('ACCOUNT', 'CAMPAIGN', 'AD_GROUP', 'KEYWORD', 'AD');

-- CreateEnum
CREATE TYPE "SegmentType" AS ENUM ('DEVICE', 'LOCATION', 'HOUR_OF_DAY', 'DAY_OF_WEEK', 'NETWORK');

-- CreateEnum
CREATE TYPE "SegmentScope" AS ENUM ('ACCOUNT', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('INCREASE_BUDGET', 'DECREASE_BUDGET', 'PAUSE_KEYWORD', 'ENABLE_KEYWORD', 'INCREASE_KEYWORD_BID', 'DECREASE_KEYWORD_BID', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD', 'CHANGE_MATCH_TYPE', 'PAUSE_AD', 'CREATE_AD_VARIANT', 'PAUSE_CAMPAIGN', 'ADJUST_TARGET_ROAS', 'ADJUST_TARGET_CPA', 'REVIEW_CONVERSION_TRACKING', 'MONITOR');

-- CreateEnum
CREATE TYPE "RecommendationTargetType" AS ENUM ('ACCOUNT', 'CAMPAIGN', 'AD_GROUP', 'KEYWORD', 'SEARCH_TERM', 'AD');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'IGNORED', 'EXECUTING', 'EXECUTED', 'FAILED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('RULE_ENGINE', 'AI', 'HYBRID', 'USER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RECOMMENDATION', 'ANOMALY', 'SPEND_SPIKE', 'ROAS_DROP', 'TRACKING_ISSUE', 'OPTIMIZATION_COMPLETED', 'OPTIMIZATION_FAILED', 'SYNC_FAILED', 'BILLING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'AGENCY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SYNC_ACCOUNT', 'ANALYZE_ACCOUNT', 'DETECT_ANOMALIES', 'EXECUTE_ACTIONS', 'SEND_DIGEST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "name" TEXT,
    "imageUrl" TEXT,
    "passwordHash" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
    "onboardingStep" TEXT NOT NULL DEFAULT 'connect',
    "onboardingDoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_connections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "googleUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "pictureUrl" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_accounts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectionId" UUID,
    "customerId" TEXT NOT NULL,
    "descriptiveName" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "isTestAccount" BOOLEAN NOT NULL DEFAULT false,
    "loginCustomerId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'NEVER_SYNCED',
    "syncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAnalyzedAt" TIMESTAMP(3),
    "summary" JSONB,
    "summaryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimization_settings" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "mode" "OptimizationMode" NOT NULL DEFAULT 'SUGGESTIONS',
    "targetRoas" DECIMAL(8,2),
    "targetCpa" DECIMAL(12,2),
    "maxDailyBudget" DECIMAL(12,2),
    "minProfitPerConversion" DECIMAL(12,2),
    "grossMarginPct" DECIMAL(5,2),
    "cogsPct" DECIMAL(5,2),
    "leadValue" DECIMAL(12,2),
    "customerValue" DECIMAL(12,2),
    "fixedCostPerOrder" DECIMAL(12,2),
    "maxDailyBudgetIncreasePct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "maxDailyBudgetDecreasePct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "maxBidChangePct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "maxActionsPerRun" INTEGER NOT NULL DEFAULT 25,
    "minClicksForDecision" INTEGER NOT NULL DEFAULT 30,
    "minImpressionsForDecision" INTEGER NOT NULL DEFAULT 500,
    "minSpendForDecision" DECIMAL(12,2) NOT NULL DEFAULT 50,
    "minConversionsForScaling" DECIMAL(8,2) NOT NULL DEFAULT 3,
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "minConfidence" DECIMAL(3,2) NOT NULL DEFAULT 0.7,
    "autoNegativeKeywords" BOOLEAN NOT NULL DEFAULT false,
    "autoAddKeywords" BOOLEAN NOT NULL DEFAULT false,
    "autoBidChanges" BOOLEAN NOT NULL DEFAULT false,
    "autoBudgetChanges" BOOLEAN NOT NULL DEFAULT false,
    "autoPauseKeywords" BOOLEAN NOT NULL DEFAULT false,
    "autoPauseAds" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnRecommendation" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnAnomaly" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnAutoAction" BOOLEAN NOT NULL DEFAULT true,
    "weeklyReportEmail" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "optimization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "advertisingChannel" TEXT NOT NULL DEFAULT 'SEARCH',
    "biddingStrategyType" TEXT,
    "budgetId" TEXT,
    "budgetName" TEXT,
    "budgetAmountMicros" BIGINT NOT NULL DEFAULT 0,
    "budgetIsShared" BOOLEAN NOT NULL DEFAULT false,
    "budgetDeliveryMethod" TEXT,
    "targetRoas" DECIMAL(8,4),
    "targetCpaMicros" BIGINT,
    "startDate" DATE,
    "endDate" DATE,
    "isBudgetLimited" BOOLEAN NOT NULL DEFAULT false,
    "optimizationScore" DECIMAL(5,4),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_groups" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "campaignRowId" UUID NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "type" TEXT,
    "cpcBidMicros" BIGINT,
    "targetRoas" DECIMAL(8,4),
    "targetCpaMicros" BIGINT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "campaignRowId" UUID NOT NULL,
    "adGroupRowId" UUID NOT NULL,
    "criterionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "EntityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "isNegative" BOOLEAN NOT NULL DEFAULT false,
    "cpcBidMicros" BIGINT,
    "effectiveCpcBidMicros" BIGINT,
    "qualityScore" INTEGER,
    "expectedCtr" TEXT,
    "adRelevance" TEXT,
    "landingPageExp" TEXT,
    "firstPageCpcMicros" BIGINT,
    "topOfPageCpcMicros" BIGINT,
    "finalUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_terms" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "campaignRowId" UUID,
    "adGroupRowId" UUID,
    "text" TEXT NOT NULL,
    "searchTermKey" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "SearchTermStatus" NOT NULL DEFAULT 'NONE',
    "triggeredKeyword" TEXT,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValueMicros" BIGINT NOT NULL DEFAULT 0,
    "intent" "SearchTermIntent" NOT NULL DEFAULT 'UNCLASSIFIED',
    "intentReason" TEXT,
    "classifiedAt" TIMESTAMP(3),
    "classifiedModel" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "campaignRowId" UUID NOT NULL,
    "adGroupRowId" UUID NOT NULL,
    "adId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RESPONSIVE_SEARCH_AD',
    "status" "EntityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "adStrength" TEXT,
    "headlines" JSONB NOT NULL DEFAULT '[]',
    "descriptions" JSONB NOT NULL DEFAULT '[]',
    "finalUrls" TEXT[],
    "path1" TEXT,
    "path2" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_variants" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "adGroupRowId" UUID NOT NULL,
    "sourceAdRowId" UUID,
    "headlines" JSONB NOT NULL DEFAULT '[]',
    "descriptions" JSONB NOT NULL DEFAULT '[]',
    "finalUrl" TEXT,
    "path1" TEXT,
    "path2" TEXT,
    "rationale" TEXT,
    "status" "AdVariantStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedBy" TEXT,
    "publishedAdId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "conversionActionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "type" TEXT,
    "status" TEXT,
    "countingType" TEXT,
    "includeInConversionsMetric" BOOLEAN NOT NULL DEFAULT true,
    "primaryForGoal" BOOLEAN NOT NULL DEFAULT true,
    "valuePerConversionMicros" BIGINT,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValueMicros" BIGINT NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "level" "MetricLevel" NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignRowId" UUID,
    "adGroupRowId" UUID,
    "keywordRowId" UUID,
    "adRowId" UUID,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValueMicros" BIGINT NOT NULL DEFAULT 0,
    "allConversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allConversionValueMicros" BIGINT NOT NULL DEFAULT 0,
    "interactions" BIGINT NOT NULL DEFAULT 0,
    "videoViews" BIGINT NOT NULL DEFAULT 0,
    "searchImpressionShare" DECIMAL(6,4),
    "searchBudgetLostImprShare" DECIMAL(6,4),
    "searchRankLostImprShare" DECIMAL(6,4),
    "topImpressionPercentage" DECIMAL(6,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_performance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "scope" "SegmentScope" NOT NULL DEFAULT 'ACCOUNT',
    "scopeId" TEXT NOT NULL,
    "segmentType" "SegmentType" NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "segmentLabel" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValueMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "batchId" UUID,
    "type" "RecommendationType" NOT NULL,
    "targetType" "RecommendationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "source" "RecommendationSource" NOT NULL DEFAULT 'HYBRID',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "risk" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "confidence" DECIMAL(3,2) NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "estimatedMonthlyImpact" DECIMAL(12,2),
    "model" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "recommendationId" UUID,
    "type" "RecommendationType" NOT NULL,
    "targetType" "RecommendationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'QUEUED',
    "actorType" "ActorType" NOT NULL DEFAULT 'AI',
    "requestedById" UUID,
    "payload" JSONB NOT NULL,
    "previousState" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "rollbackOfId" UUID,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_logs" (
    "id" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomalies" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "entityType" "RecommendationTargetType" NOT NULL DEFAULT 'ACCOUNT',
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'WARNING',
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentValue" DECIMAL(16,4) NOT NULL,
    "baselineValue" DECIMAL(16,4) NOT NULL,
    "changePct" DECIMAL(10,4) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "details" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolName" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountId" UUID,
    "userId" UUID,
    "type" "NotificationType" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" UUID,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "seats" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "accountId" UUID,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "runKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_userId_type_idx" ON "verification_tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "verification_tokens_expiresAt_idx" ON "verification_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_organizationId_email_key" ON "invitations"("organizationId", "email");

-- CreateIndex
CREATE INDEX "google_connections_organizationId_idx" ON "google_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_organizationId_googleUserId_key" ON "google_connections"("organizationId", "googleUserId");

-- CreateIndex
CREATE INDEX "google_ads_accounts_organizationId_idx" ON "google_ads_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "google_ads_accounts_connectionId_idx" ON "google_ads_accounts"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_accounts_organizationId_customerId_key" ON "google_ads_accounts"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "optimization_settings_accountId_key" ON "optimization_settings"("accountId");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_accountId_idx" ON "campaigns"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "campaigns_accountId_status_idx" ON "campaigns"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_accountId_campaignId_key" ON "campaigns"("accountId", "campaignId");

-- CreateIndex
CREATE INDEX "ad_groups_organizationId_accountId_idx" ON "ad_groups"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "ad_groups_campaignRowId_idx" ON "ad_groups"("campaignRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_groups_accountId_adGroupId_key" ON "ad_groups"("accountId", "adGroupId");

-- CreateIndex
CREATE INDEX "keywords_organizationId_accountId_idx" ON "keywords"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "keywords_accountId_status_idx" ON "keywords"("accountId", "status");

-- CreateIndex
CREATE INDEX "keywords_adGroupRowId_idx" ON "keywords"("adGroupRowId");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_accountId_adGroupRowId_criterionId_key" ON "keywords"("accountId", "adGroupRowId", "criterionId");

-- CreateIndex
CREATE INDEX "search_terms_organizationId_accountId_idx" ON "search_terms"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "search_terms_accountId_intent_idx" ON "search_terms"("accountId", "intent");

-- CreateIndex
CREATE UNIQUE INDEX "search_terms_accountId_searchTermKey_key" ON "search_terms"("accountId", "searchTermKey");

-- CreateIndex
CREATE INDEX "ads_organizationId_accountId_idx" ON "ads"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "ads_adGroupRowId_idx" ON "ads"("adGroupRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ads_accountId_adId_key" ON "ads"("accountId", "adId");

-- CreateIndex
CREATE INDEX "ad_variants_organizationId_accountId_idx" ON "ad_variants"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "ad_variants_accountId_status_idx" ON "ad_variants"("accountId", "status");

-- CreateIndex
CREATE INDEX "conversions_organizationId_accountId_idx" ON "conversions"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_accountId_conversionActionId_key" ON "conversions"("accountId", "conversionActionId");

-- CreateIndex
CREATE INDEX "daily_metrics_organizationId_accountId_date_idx" ON "daily_metrics"("organizationId", "accountId", "date");

-- CreateIndex
CREATE INDEX "daily_metrics_accountId_level_date_idx" ON "daily_metrics"("accountId", "level", "date");

-- CreateIndex
CREATE INDEX "daily_metrics_campaignRowId_date_idx" ON "daily_metrics"("campaignRowId", "date");

-- CreateIndex
CREATE INDEX "daily_metrics_keywordRowId_date_idx" ON "daily_metrics"("keywordRowId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_accountId_level_entityId_date_key" ON "daily_metrics"("accountId", "level", "entityId", "date");

-- CreateIndex
CREATE INDEX "segment_performance_organizationId_accountId_segmentType_da_idx" ON "segment_performance"("organizationId", "accountId", "segmentType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "segment_performance_accountId_scope_scopeId_segmentType_seg_key" ON "segment_performance"("accountId", "scope", "scopeId", "segmentType", "segmentKey", "date");

-- CreateIndex
CREATE INDEX "ai_recommendations_organizationId_accountId_status_idx" ON "ai_recommendations"("organizationId", "accountId", "status");

-- CreateIndex
CREATE INDEX "ai_recommendations_accountId_status_priority_idx" ON "ai_recommendations"("accountId", "status", "priority");

-- CreateIndex
CREATE INDEX "ai_recommendations_createdAt_idx" ON "ai_recommendations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_recommendations_accountId_dedupeKey_key" ON "ai_recommendations"("accountId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_actions_idempotencyKey_key" ON "ai_actions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ai_actions_organizationId_accountId_status_idx" ON "ai_actions"("organizationId", "accountId", "status");

-- CreateIndex
CREATE INDEX "ai_actions_accountId_createdAt_idx" ON "ai_actions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_action_logs_actionId_createdAt_idx" ON "ai_action_logs"("actionId", "createdAt");

-- CreateIndex
CREATE INDEX "anomalies_organizationId_accountId_status_idx" ON "anomalies"("organizationId", "accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "anomalies_accountId_dedupeKey_key" ON "anomalies"("accountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "chat_threads_organizationId_userId_updatedAt_idx" ON "chat_threads"("organizationId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "chat_messages_threadId_createdAt_idx" ON "chat_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_readAt_createdAt_idx" ON "notifications"("organizationId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organizationId_dedupeKey_key" ON "notifications"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organizationId_period_metric_key" ON "usage_counters"("organizationId", "period", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_runKey_key" ON "job_runs"("runKey");

-- CreateIndex
CREATE INDEX "job_runs_type_startedAt_idx" ON "job_runs"("type", "startedAt");

-- CreateIndex
CREATE INDEX "job_runs_accountId_type_startedAt_idx" ON "job_runs"("accountId", "type", "startedAt");

-- CreateIndex
CREATE INDEX "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_accounts" ADD CONSTRAINT "google_ads_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_accounts" ADD CONSTRAINT "google_ads_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "google_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimization_settings" ADD CONSTRAINT "optimization_settings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_campaignRowId_fkey" FOREIGN KEY ("campaignRowId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_campaignRowId_fkey" FOREIGN KEY ("campaignRowId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_adGroupRowId_fkey" FOREIGN KEY ("adGroupRowId") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_campaignRowId_fkey" FOREIGN KEY ("campaignRowId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_adGroupRowId_fkey" FOREIGN KEY ("adGroupRowId") REFERENCES "ad_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaignRowId_fkey" FOREIGN KEY ("campaignRowId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_adGroupRowId_fkey" FOREIGN KEY ("adGroupRowId") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_variants" ADD CONSTRAINT "ad_variants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_variants" ADD CONSTRAINT "ad_variants_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_variants" ADD CONSTRAINT "ad_variants_adGroupRowId_fkey" FOREIGN KEY ("adGroupRowId") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_variants" ADD CONSTRAINT "ad_variants_sourceAdRowId_fkey" FOREIGN KEY ("sourceAdRowId") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_campaignRowId_fkey" FOREIGN KEY ("campaignRowId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_adGroupRowId_fkey" FOREIGN KEY ("adGroupRowId") REFERENCES "ad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_keywordRowId_fkey" FOREIGN KEY ("keywordRowId") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_adRowId_fkey" FOREIGN KEY ("adRowId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_performance" ADD CONSTRAINT "segment_performance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_performance" ADD CONSTRAINT "segment_performance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "ai_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_rollbackOfId_fkey" FOREIGN KEY ("rollbackOfId") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ai_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "google_ads_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

