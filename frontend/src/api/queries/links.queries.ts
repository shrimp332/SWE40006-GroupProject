import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const LINKS_QK = "links";
export const LINK_STATS_QK = "link-stats";

export interface Link {
  code: string;
  target_url: string;
  created_at: string;
  expires_at: string | null;
  disabled: boolean;
}

export interface LinkStats {
  code: string;
  total_clicks: number;
  clicks_per_day: { date: string; clicks: number }[];
  referrers: { referrer: string | null; clicks: number }[];
  user_agents: { user_agent: string | null; clicks: number }[];
}

const links = queryOptions({
  queryKey: [LINKS_QK],
  queryFn: async () => api.get("/links").json<Link[]>(),
});

const stats = (code: string) =>
  queryOptions({
    queryKey: [LINK_STATS_QK, code],
    queryFn: async () => api.get(`/links/${code}/stats`).json<LinkStats>(),
  });

export const linkQuery = {
  links: links,
  stats,
};
