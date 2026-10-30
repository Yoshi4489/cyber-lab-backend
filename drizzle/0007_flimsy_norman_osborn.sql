ALTER TYPE "public"."challenge_kind" ADD VALUE 'artifact';--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "instance_id" DROP NOT NULL;