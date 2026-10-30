import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardBody, CardHeader, CardTitle, Container, PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth-session";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const user = await requireUser("/profile");
  return (
    <Container className="py-8">
      <PageHeader title="Your profile" description="Manage your account details and password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardBody>
            <ProfileForm name={user.name} email={user.email} phone={user.phone} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
      </div>
    </Container>
  );
}
