# Manual test — Home dashboard v2 · session 0b (capture: messaging)

Run `20270176000000_dashboard_capture_messages.sql` and read the select at its end: expect
`new_columns_expect_3 = 3`, `new_triggers_expect_2 = 2`, `token_chat_marks_read = true`,
`messages_without_role_expect_0 = 0`. `messages_by_role` shows the backfill split; `unknown` is
history nobody signed (it still counts as a reply). `accounts_awaiting_reply_right_now` is the
number the dashboard tile will show on day one.

1. **Customer writes in.** Open a sent estimate's link in a private window, press the chat
   button, send "Can you do the ceilings too?". On Today a Message card appears for that customer.
2. **An automation chases.** Trigger any automation to that customer (or wait for one). The
   Message card is STILL on Today, and the record's Messages tab shows the chase with no reply.
3. **A person replies.** In the builder's Chat tab (or Messages → reply on the record) answer them.
   The card clears.
4. **The customer reads it.** Reopen the private window's chat. On the record's Messages tab the
   reply now shows as read.
5. **Email open.** Send the customer an email from the record; open it in their mailbox. Once
   Resend's webhook fires the message shows as opened and read (best-effort).
6. **Legacy history.** Old sends from before today read as staff, system or "unknown" on the
   record; nothing that was answered before today comes back onto Today.
