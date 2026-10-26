import { faqCategorySchema, faqItemSchema, noteSchema, staffReplySchema, ticketListQuerySchema, ticketUpdateSchema } from "../../src/domain/support/schema";
import type { AdminRouter } from "../api";
import { errorResponse, json } from "../http";
import type { SupportService } from "../support/service";
import { parseBody, parseQuery } from "./common";

/** Staff-facing support and FAQ endpoints. Permission checks live in SupportService (not here). */
export function createSupportAdminRoutes(support: SupportService): AdminRouter {
  return async ({ request, url, method, path, principal }) => {
    const actor = { userId: principal.userId, email: principal.email, role: principal.role };

    if (path === "/support/tickets" && method === "GET") {
      const query = parseQuery(url.searchParams, ticketListQuerySchema);
      if (!query.ok) return query.response;
      return json(await support.listTickets(actor, query.data));
    }
    if (path === "/support/stats" && method === "GET") return json({ byStatus: await support.stats(actor) });

    const ticket = /^\/support\/tickets\/(\d{1,10})(\/reply|\/notes)?$/.exec(path);
    if (ticket) {
      const number = Number(ticket[1]);
      const sub = ticket[2];
      if (!sub && method === "GET") return json({ ticket: await support.getTicket(actor, number) });
      if (!sub && method === "PATCH") {
        const body = await parseBody(request, ticketUpdateSchema);
        if (!body.ok) return body.response;
        await support.updateTicket(actor, number, body.data);
        return json({ ok: true });
      }
      if (sub === "/reply" && method === "POST") {
        const body = await parseBody(request, staffReplySchema);
        if (!body.ok) return body.response;
        await support.reply(actor, number, body.data.body, body.data.status);
        return json({ ok: true }, 201);
      }
      if (sub === "/notes" && method === "POST") {
        const body = await parseBody(request, noteSchema);
        if (!body.ok) return body.response;
        await support.addNote(actor, number, body.data.body);
        return json({ ok: true }, 201);
      }
      return errorResponse("method_not_allowed", 405);
    }

    if (path === "/faq" && method === "GET") return json(await support.listFaqForAdmin(actor));
    if (path === "/faq/items" && method === "PUT") {
      const body = await parseBody(request, faqItemSchema);
      if (!body.ok) return body.response;
      await support.saveFaqItem(actor, body.data);
      return json({ ok: true });
    }
    if (path === "/faq/categories" && method === "PUT") {
      const body = await parseBody(request, faqCategorySchema);
      if (!body.ok) return body.response;
      await support.saveFaqCategory(actor, body.data);
      return json({ ok: true });
    }
    const faqItem = /^\/faq\/items\/([a-z0-9-]{1,80})$/.exec(path);
    if (faqItem && method === "DELETE") {
      await support.deleteFaqItem(actor, faqItem[1] as string);
      return json({ ok: true });
    }
    if (path === "/faq/seed" && method === "POST") {
      return json({ created: await support.seedFaq(actor) });
    }
    return null;
  };
}
