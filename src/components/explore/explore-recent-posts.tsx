import type { ContactExploreRecentPost } from "@/lib/db/queries/contact-explore";
import { formatRelativeGeneratedAt } from "@/components/explore/explore-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ExploreRecentPostsProps = {
  posts: ContactExploreRecentPost[];
};

export function ExploreRecentPosts({ posts }: ExploreRecentPostsProps) {
  if (posts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent posts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id} className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0">
              <p className="line-clamp-3 text-sm">{post.text}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {post.publishedAt != null && (
                  <span>{formatRelativeGeneratedAt(post.publishedAt)}</span>
                )}
                {post.url && (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    View post ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
