import { redirect } from "next/navigation";

/**
 * Session 3 placeholder — session 4 renders the shared job timeline here
 * (organisation → property → job scoping). Until then the existing account
 * timeline stands in; it shows the account's leading job by stage
 * precedence, which is the property's active job for the common case.
 */
export default async function PropertyJobTimelinePage() {
  redirect("/account/project");
}
