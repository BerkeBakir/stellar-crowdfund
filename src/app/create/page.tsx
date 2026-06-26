import Link from 'next/link';
import CreateForm from '@/components/CreateForm';

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-md p-4 sm:p-6 flex flex-col gap-4">
      <Link href="/" className="text-sm opacity-70">← Back</Link>
      <h1 className="text-xl font-bold">Create a campaign</h1>
      <CreateForm />
    </main>
  );
}
