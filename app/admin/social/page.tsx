import { format } from "date-fns";
import { SocialPostForm } from "@/components/AdminForm";
import { missingSocialCredentials } from "@/lib/social";
import { prisma } from "@/lib/prisma";

export default async function AdminSocialPage() {
  const posts = await prisma.socialPost.findMany({
    include: { product: true, popupEvent: true, assets: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }]
  });
  const missing = Array.from(new Set((await Promise.all(posts.map((post) => missingSocialCredentials(post.platforms)))).flat()));

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <SocialPostForm />
        <div className="panel p-4">
          <h2 className="text-lg font-black">AI idea prompts</h2>
          <p className="mt-2 text-sm text-ink/70">
            Prepare and review your captions here. Automatic publishing is not connected yet; copy approved content into your social platform.
          </p>
        </div>
      </div>
      <section className="space-y-4">
        {missing.length ? (
          <div className="rounded-lg border border-jam bg-white p-4 text-sm font-semibold text-jam">
            Automatic publishing is not connected. Missing account credentials: {missing.join(", ")}
          </div>
        ) : null}
        <div className="grid gap-3">
          {posts.map((post) => (
            <article className="panel p-4" key={post.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase text-sage">{post.platforms.join(", ")}</p>
                  <h2 className="font-black">{post.title}</h2>
                </div>
                <span className="badge bg-crumb text-ink">{post.status.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink/75">{post.caption}</p>
              <p className="mt-2 text-xs font-semibold text-jam">{post.hashtags.join(" ")}</p>
              <p className="mt-2 text-xs text-ink/60">
                {post.scheduledAt ? `Scheduled ${format(post.scheduledAt, "MMM d, h:mm a")}` : "Unscheduled"}
                {post.product ? ` · Product: ${post.product.name}` : ""}
                {post.popupEvent ? ` · Event: ${post.popupEvent.title}` : ""}
              </p>
              {post.failureReason ? <p className="mt-3 rounded-md bg-crumb p-3 text-sm font-semibold text-jam">{post.failureReason}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
