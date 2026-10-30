CREATE TYPE "public"."instance_operation_status" AS ENUM('pending', 'queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."instance_operation_type" AS ENUM('spawn', 'extend', 'destroy', 'reap', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('pending', 'provisioning', 'running', 'stopping', 'stopped', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."lab_node_status" AS ENUM('active', 'draining', 'offline');--> statement-breakpoint
CREATE TABLE "instance_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "instance_operation_type" NOT NULL,
	"status" "instance_operation_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "instance_operations_attempts_nonnegative" CHECK ("instance_operations"."attempts" >= 0),
	CONSTRAINT "instance_operations_completed_after_creation" CHECK ("instance_operations"."completed_at" is null or "instance_operations"."completed_at" >= "instance_operations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"node_id" uuid,
	"status" "instance_status" DEFAULT 'pending' NOT NULL,
	"route_key" varchar(64),
	"container_id" varchar(128),
	"network_id" varchar(128),
	"failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "instances_expiry_before_absolute" CHECK ("instances"."expires_at" <= "instances"."absolute_expires_at"),
	CONSTRAINT "instances_started_after_creation" CHECK ("instances"."started_at" is null or "instances"."started_at" >= "instances"."created_at"),
	CONSTRAINT "instances_stopped_after_creation" CHECK ("instances"."stopped_at" is null or "instances"."stopped_at" >= "instances"."created_at")
);
--> statement-breakpoint
CREATE TABLE "lab_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"status" "lab_node_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_nodes_name_normalized" CHECK ("lab_nodes"."name" = lower("lab_nodes"."name"))
);
--> statement-breakpoint
ALTER TABLE "instance_operations" ADD CONSTRAINT "instance_operations_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_operations" ADD CONSTRAINT "instance_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_node_id_lab_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."lab_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instance_operations_idempotency_unique" ON "instance_operations" USING btree ("user_id","type","idempotency_key");--> statement-breakpoint
CREATE INDEX "instance_operations_instance_created_idx" ON "instance_operations" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "instance_operations_delivery_idx" ON "instance_operations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_route_key_unique" ON "instances" USING btree ("route_key");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_one_active_per_user" ON "instances" USING btree ("user_id") WHERE "instances"."status" in ('pending', 'provisioning', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX "instances_user_created_idx" ON "instances" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "instances_status_expiry_idx" ON "instances" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "instances_node_status_idx" ON "instances" USING btree ("node_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_nodes_name_unique" ON "lab_nodes" USING btree ("name");--> statement-breakpoint
CREATE INDEX "lab_nodes_status_idx" ON "lab_nodes" USING btree ("status");