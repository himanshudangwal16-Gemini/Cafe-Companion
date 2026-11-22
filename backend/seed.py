"""Idempotent CLI seeder for Café Companion Firestore Native sample menu & ambient logs."""
import asyncio
import os

from dotenv import load_dotenv

from app.firestore_repo import FirestoreNativeRepo

load_dotenv()


async def main() -> None:
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT_ID")
    database = os.getenv("FIRESTORE_DATABASE", "(default)")
    repo = FirestoreNativeRepo(project_id=project_id, database=database)
    result = await repo.seed_sample_data()
    print(f"Firestore Native seed complete for project={project_id or 'ADC-default'}: {result}")


if __name__ == "__main__":
    asyncio.run(main())
