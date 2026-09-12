export class Tracker {
	// keeps track of the pointer ids that are currently held down, we use this
	// to detect multi touch which is when there is more than one pointer id
	private down = new Set<number>();

	add(id: number): void {
		this.down.add(id);
	}
}
