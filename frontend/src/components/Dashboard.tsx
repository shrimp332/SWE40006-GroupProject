import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { LINKS_QK, linkQuery } from "../api/queries/links.queries";
import { linkMutation } from "../api/mutations/links.mutations";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Link, LinkStats } from "../api/queries/links.queries";

/** Disabled takes precedence: the owner turned it off whatever the expiry says. */
function stateCell(link: Link) {
    if (link.disabled) return "Disabled";
    if (link.expires_at !== null && new Date(link.expires_at) <= new Date()) return "Expired";

    return "Active";
}

function clicksCell(stats: UseQueryResult<LinkStats> | undefined) {
    if (!stats || stats.isPending) return "...";
    if (stats.isError) return "?";

    return stats.data.total_clicks;
}

const CELL = "border-b border-zinc-200 px-3 py-2 text-left align-middle";
const HEAD = "border-b border-zinc-300 bg-zinc-100 px-3 py-2 text-left font-semibold text-zinc-700";

const STATE_BADGE: Record<string, string> = {
    Active: "bg-green-100 text-green-800",
    Disabled: "bg-zinc-200 text-zinc-700",
    Expired: "bg-amber-100 text-amber-800",
};

function Dashboard() {
    const qc = useQueryClient();
    const { data: links, isPending, isError } = useQuery(linkQuery.links);

    const statsQueries = useQueries({
        queries: (links ?? []).map((link) => linkQuery.stats(link.code)),
    });

    const setDisabled = useMutation({
        ...linkMutation.setDisabled,
        onSettled: () => qc.invalidateQueries({ queryKey: [LINKS_QK] }),
    });

    const remove = useMutation({
        ...linkMutation.remove,
        onSettled: () => qc.invalidateQueries({ queryKey: [LINKS_QK] }),
    });

    const busy = setDisabled.isPending || remove.isPending;

    if (isPending) return <p className="mt-4 text-zinc-500">Loading...</p>;
    if (isError) return <p className="mt-4 text-red-700">Could not load your links.</p>;

    if (links.length === 0) {
        return (
            <p className="mt-4 border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
                No redirects yet. Use Add redirect to create your first short link.
            </p>
        );
    }

    return (
        <table className="mt-4 w-full border-collapse border border-zinc-200 text-sm">
            <thead>
                <tr>
                    <th className={HEAD}>Destination</th>
                    <th className={HEAD}>Code</th>
                    <th className={HEAD}>Clicks</th>
                    <th className={HEAD}>State</th>
                    <th className={HEAD}>Actions</th>
                </tr>
            </thead>
            <tbody>
                {links.map((link, index) => (
                    <tr key={link.code} className="hover:bg-zinc-50">
                        <td className={`${CELL} max-w-xs truncate`} title={link.target_url}>{link.target_url}</td>
                        <td className={CELL}>
                            <a href={`/x/${link.code}`} className="font-mono text-orange-700 hover:underline">{link.code}</a>
                        </td>
                        <td className={CELL}>{clicksCell(statsQueries[index])}</td>
                        <td className={CELL}>
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_BADGE[stateCell(link)]}`}>{stateCell(link)}</span>
                        </td>
                        <td className={CELL}>
                            <button
                                onClick={() => setDisabled.mutate({ code: link.code, disabled: !link.disabled })}
                                disabled={busy}
                                className="cursor-pointer border border-orange-600 px-2 py-1 text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-25"
                            >
                                {link.disabled ? "Enable" : "Disable"}
                            </button>{" "}
                            <button
                                onClick={() => remove.mutate(link.code)}
                                disabled={busy}
                                className="cursor-pointer border border-red-600 px-2 py-1 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-25"
                            >
                                Delete
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default Dashboard;
