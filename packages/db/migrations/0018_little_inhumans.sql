CREATE TABLE "locker_event_request_links" (
	"locker_event_request_id" uuid PRIMARY KEY NOT NULL,
	"locker_submission_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locker_event_request_links_hash_check" CHECK ("locker_event_request_links"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "locker_event_request_links" ADD CONSTRAINT "locker_event_request_links_locker_submission_id_locker_submission_links_locker_submission_id_fk" FOREIGN KEY ("locker_submission_id") REFERENCES "public"."locker_submission_links"("locker_submission_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "locker_event_request_links" ADD CONSTRAINT "locker_event_request_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "locker_event_request_links_submission_uidx" ON "locker_event_request_links" USING btree ("locker_submission_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "locker_event_request_links_task_uidx" ON "locker_event_request_links" USING btree ("task_id");
