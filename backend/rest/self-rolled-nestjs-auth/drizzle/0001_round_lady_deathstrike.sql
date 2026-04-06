CREATE TABLE "oauth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"provider" text NOT NULL,
	"providerId" text NOT NULL,
	CONSTRAINT "oauth_accounts_provider_providerId_unique" UNIQUE("provider","providerId")
);
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;