export function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" role="search" className="search">
      <label htmlFor="q" className="sr-only">
        Search papers
      </label>
      <input id="q" name="q" type="search" defaultValue={defaultValue} placeholder="Search any paper" autoComplete="off" required />
      <button type="submit">Search</button>
    </form>
  );
}
