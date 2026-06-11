-- Invite tokens must be globally unique so redemption can be made single-use
-- via an atomic guarded update (one signup wins the race; the rest see no
-- rows affected). Replaces the prior non-unique lookup index.
--
-- Random 18-byte base64url tokens make pre-existing collisions effectively
-- impossible, so no de-duplication step is required before adding the unique
-- index. If a collision somehow existed, this statement would fail loudly
-- rather than corrupt data — which is the desired behavior.

-- DropIndex
DROP INDEX "Invite_token_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");
