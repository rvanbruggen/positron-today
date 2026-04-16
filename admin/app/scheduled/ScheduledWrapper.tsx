"use client";

import dynamic from "next/dynamic";

type ArticleTag = { id: number; name: string; emoji: string };

type Article = {
  id: number;
  status: string;
  source_url: string;
  source_name: string;
  raw_title: string | null;
  article_emoji: string | null;
  tags: ArticleTag[];
  title_en: string | null;
  title_nl: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_nl: string | null;
  summary_fr: string | null;
  publish_date: string | null;
  post_to_social_on_publish: boolean;
  featured: boolean;
  positivity_score: number | null;
};

const ScheduledClient = dynamic(() => import("./ScheduledClient"), {
  ssr: false,
});

export default function ScheduledWrapper({
  initialArticles,
  tags,
}: {
  initialArticles: Article[];
  tags: ArticleTag[];
}) {
  return <ScheduledClient initialArticles={initialArticles} tags={tags} />;
}
