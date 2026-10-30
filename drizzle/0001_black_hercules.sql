CREATE TYPE "public"."challenge_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."challenge_kind" AS ENUM('web', 'shell');--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"category" varchar(64) NOT NULL,
	"difficulty" "challenge_difficulty" NOT NULL,
	"points" integer NOT NULL,
	"kind" "challenge_kind" NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_slug_normalized" CHECK ("challenges"."slug" = lower("challenges"."slug")),
	CONSTRAINT "challenges_category_normalized" CHECK ("challenges"."category" = lower("challenges"."category")),
	CONSTRAINT "challenges_points_positive" CHECK ("challenges"."points" > 0),
	CONSTRAINT "challenges_definition_version_positive" CHECK ("challenges"."definition_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "solves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"first_submission_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"solved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solves_points_positive" CHECK ("solves"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"correct" boolean NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_points_nonnegative" CHECK ("submissions"."points_awarded" >= 0),
	CONSTRAINT "submissions_incorrect_awards_no_points" CHECK ("submissions"."correct" or "submissions"."points_awarded" = 0)
);
--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_first_submission_id_submissions_id_fk" FOREIGN KEY ("first_submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_slug_unique" ON "challenges" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "challenges_published_category_idx" ON "challenges" USING btree ("published","category");--> statement-breakpoint
CREATE UNIQUE INDEX "solves_user_challenge_unique" ON "solves" USING btree ("user_id","challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "solves_first_submission_unique" ON "solves" USING btree ("first_submission_id");--> statement-breakpoint
CREATE INDEX "solves_user_solved_at_idx" ON "solves" USING btree ("user_id","solved_at");--> statement-breakpoint
CREATE INDEX "solves_leaderboard_idx" ON "solves" USING btree ("points","solved_at");--> statement-breakpoint
CREATE INDEX "submissions_user_challenge_created_idx" ON "submissions" USING btree ("user_id","challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_instance_idx" ON "submissions" USING btree ("instance_id");