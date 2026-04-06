CREATE TYPE "public"."providers" AS ENUM('github', 'google');--> statement-breakpoint
CREATE TYPE "public"."mfa_method" AS ENUM('totp', 'email');--> statement-breakpoint
CREATE TABLE "mfa_backup_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_accounts" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "oauth_accounts" RENAME COLUMN "providerId" TO "provider_id";--> statement-breakpoint
ALTER TABLE "oauth_accounts" DROP CONSTRAINT "oauth_accounts_provider_providerId_unique";--> statement-breakpoint
ALTER TABLE "oauth_accounts" DROP CONSTRAINT "oauth_accounts_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ALTER COLUMN "provider" SET DATA TYPE "public"."providers" USING "provider"::"public"."providers";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_default_method" "mfa_method";--> statement-breakpoint
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_provider_provider_id_unique" UNIQUE("provider","provider_id");