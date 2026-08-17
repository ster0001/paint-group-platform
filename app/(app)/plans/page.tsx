import PlanReader from "./PlanReader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Read a floorplan · Paint Group" };

// Staff-only: the (app) layout redirects anyone who isn't staff.
export default function PlansPage() {
  return <PlanReader />;
}
