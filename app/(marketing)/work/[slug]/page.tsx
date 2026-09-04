import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Nav from "../../_sections/Nav";
import Footer from "../../_sections/Footer";
import CallBar from "../../_sections/CallBar";
import ProjectPage from "../../_components/ProjectPage";
import { publishedShowcaseJobs, relatedShowcaseJobs, showcaseJobBySlug } from "@/lib/showcase/queries";
import { formatPriceRange, showcaseMediaUrl } from "@/lib/showcase/format";

/**
 * /work/[slug] — one showcase job through THE template (brief §4.4c).
 * Statically generated with ISR: every published slug is built ahead,
 * unknown slugs render on demand, unpublished ones 404, and the save action
 * revalidates the path so an edit is live within a minute.
 */
export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  const jobs = await publishedShowcaseJobs();
  return jobs.map((j) => ({ slug: j.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = await showcaseJobBySlug(slug);
  if (!job) return { title: "Job not found — Paint Group" };
  const price = job.price_low_cents != null && job.price_high_cents != null ? formatPriceRange(job.price_low_cents, job.price_high_cents) : "";
  const title = `${job.title} in ${job.suburb}${price ? ` — ${price}` : ""} | Paint Group`;
  const description = job.summary || job.scope_line || `${job.title} in ${job.suburb}, painted by Paint Group.`;
  return {
    title,
    description,
    openGraph: {
      title, description, type: "article",
      images: job.hero_path ? [{ url: showcaseMediaUrl(job.hero_path), alt: `${job.title} in ${job.suburb}` }] : [],
    },
  };
}

export default async function WorkJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await showcaseJobBySlug(slug);
  if (!job) notFound();
  const all = await publishedShowcaseJobs();
  const related = relatedShowcaseJobs(all, job);

  // Article JSON-LD — deliberately no Product/Offer markup: prices are ranges
  // for a finished job, not an offer (§4.4c).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${job.title} in ${job.suburb}`,
    description: job.summary || job.scope_line,
    image: job.hero_path ? [showcaseMediaUrl(job.hero_path)] : undefined,
    datePublished: job.published_at ?? undefined,
    dateModified: job.updated_at || undefined,
    author: { "@type": "Organization", name: "Paint Group" },
    publisher: { "@type": "Organization", name: "Paint Group" },
  };

  return (
    <>
      <Nav />
      <main>
        <ProjectPage job={job} related={related} />
      </main>
      <Footer />
      <CallBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
