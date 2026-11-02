import { useState } from "react";

interface User {
  id: number;
  name: string;
}

/** A React island that gets page props from the Astro page component. */
export default function UserFilter({ users }: { users: User[] }) {
  const [query, setQuery] = useState("");
  const shown = users.filter((user) => user.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <label>
        Filter <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter users" />
      </label>
      <ul data-testid="users">
        {shown.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
