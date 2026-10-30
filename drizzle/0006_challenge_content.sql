CREATE TABLE "challenge_hints" (
	"challenge_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"body_md" text NOT NULL,
	"cost" integer NOT NULL,
	CONSTRAINT "challenge_hints_challenge_id_position_pk" PRIMARY KEY("challenge_id","position"),
	CONSTRAINT "challenge_hints_position_positive" CHECK ("challenge_hints"."position" > 0),
	CONSTRAINT "challenge_hints_cost_nonnegative" CHECK ("challenge_hints"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "challenge_unlocks" (
	"user_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"item" varchar(32) NOT NULL,
	"cost_applied" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_unlocks_user_id_challenge_id_item_pk" PRIMARY KEY("user_id","challenge_id","item"),
	CONSTRAINT "challenge_unlocks_cost_nonnegative" CHECK ("challenge_unlocks"."cost_applied" >= 0)
);
--> statement-breakpoint
CREATE TABLE "challenge_walkthroughs" (
	"challenge_id" uuid PRIMARY KEY NOT NULL,
	"body_md" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solves" DROP CONSTRAINT "solves_points_positive";--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "briefing_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "objectives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "learning_outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_hints" ADD CONSTRAINT "challenge_hints_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_unlocks" ADD CONSTRAINT "challenge_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_unlocks" ADD CONSTRAINT "challenge_unlocks_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_walkthroughs" ADD CONSTRAINT "challenge_walkthroughs_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_points_nonnegative" CHECK ("solves"."points" >= 0);