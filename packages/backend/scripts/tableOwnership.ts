export function findTableOwnershipConflicts(
  declarations: ReadonlyArray<TableDeclaration>,
): ReadonlyArray<TableOwnershipConflict> {
  const ownership = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const owners = ownership.get(declaration.name) ?? new Set<string>();
    owners.add(declaration.owner);
    ownership.set(declaration.name, owners);
  }
  return Array.from(ownership, ([name, owners]) => ({
    name,
    owners: Array.from(owners).sort(),
  })).filter(({ owners }) => owners.length > 1);
}

type TableDeclaration = {
  readonly owner: string;
  readonly name: string;
};

type TableOwnershipConflict = {
  readonly name: string;
  readonly owners: ReadonlyArray<string>;
};
