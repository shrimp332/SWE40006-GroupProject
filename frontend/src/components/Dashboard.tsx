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

const CELL = "border border-zinc-300 px-2 py-1 text-left";

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

    if (isPending) return <p>Loading...</p>;
    if (isError) return <p>Could not load your links.</p>;

    return (
        <table className="border-collapse">
            <thead>
                <tr>
                    <th className={CELL}>Destination</th>
                    <th className={CELL}>Code</th>
                    <th className={CELL}>Clicks</th>
                    <th className={CELL}>State</th>
                    <th className={CELL}>Actions</th>
                </tr>
            </thead>
            <tbody>
                {links.map((link, index) => (
                    <tr key={link.code}>
                        <td className={CELL}>{link.target_url}</td>
                        <td className={CELL}>
                            <a href={`/x/${link.code}`}>{link.code}</a>
                        </td>
                        <td className={CELL}>{clicksCell(statsQueries[index])}</td>
                        <td className={CELL}>{stateCell(link)}</td>
                        <td className={CELL}>
                            <button
                                onClick={() => setDisabled.mutate({ code: link.code, disabled: !link.disabled })}
                                disabled={busy}
                            >
                                {link.disabled ? "Enable" : "Disable"}
                            </button>{" "}
                            <button
                                onClick={() => remove.mutate(link.code)}
                                disabled={busy}
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
