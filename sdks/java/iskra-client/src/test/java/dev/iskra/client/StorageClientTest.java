package dev.iskra.client;

import dev.iskra.client.exception.ForbiddenException;
import dev.iskra.client.exception.NotFoundException;
import dev.iskra.client.storage.StorageClient;
import dev.iskra.client.storage.StoredFile;
import dev.iskra.client.storage.UploadedFile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StorageClientTest {

    private final IskraClient iskra = ContractServer.client();
    private StorageClient storage;

    @BeforeEach
    void signIn() {
        String email = "files-" + UUID.randomUUID().toString().substring(0, 12) + "@example.com";
        storage = iskra.withSession(iskra.auth().signUp(email, "correct-horse-battery", null).getData()).storage();
    }

    private static List<String> names(List<StoredFile> files) {
        return files.stream().map(StoredFile::getName).collect(Collectors.toList());
    }

    @Test
    void uploadRequiresASignedInUser() {
        assertThrows(ForbiddenException.class, () -> iskra.storage().upload(new byte[] {1}, "x.txt", null));
    }

    @Test
    void uploadListDownloadDelete(@TempDir Path tmp) throws IOException {
        Path source = tmp.resolve("report.txt");
        Files.write(source, "quarterly numbers".getBytes(StandardCharsets.UTF_8));
        String folder = "reports-" + UUID.randomUUID().toString().substring(0, 8);

        UploadedFile uploaded = storage.upload(source, null, folder + "/2026");
        assertEquals("report.txt", uploaded.getFilename());
        assertEquals("contract/" + folder + "/2026/report.txt", uploaded.getPath());
        assertEquals(17, uploaded.getSize());
        assertNotNull(uploaded.getUploadedAt());

        List<StoredFile> files = storage.list(folder);
        assertEquals(List.of("report.txt"), names(files));
        assertEquals("text/plain", files.get(0).getMimeType());

        assertArrayEquals("quarterly numbers".getBytes(StandardCharsets.UTF_8), storage.download("report.txt", folder + "/2026"));

        storage.delete("report.txt", folder + "/2026");
        assertTrue(storage.list(folder).isEmpty());
        assertThrows(NotFoundException.class, () -> storage.download("report.txt", folder + "/2026"));
    }

    @Test
    void uploadBytes() {
        byte[] raw = new byte[256];
        for (int i = 0; i < raw.length; i++) {
            raw[i] = (byte) i;
        }
        storage.upload(raw, "blob.bin", "bytes");
        assertArrayEquals(raw, storage.download("blob.bin", "bytes"));
    }

    @Test
    void theServiceSanitizesNames() {
        UploadedFile uploaded = storage.upload("x".getBytes(StandardCharsets.UTF_8), "my \"report\" (final).txt", "names");
        // The quotes are sent as %22 (so they cannot end the filename early),
        // then the service maps everything outside [A-Za-z0-9._-] to "_".
        assertEquals("my__22report_22__final_.txt", uploaded.getFilename());
        assertArrayEquals("x".getBytes(StandardCharsets.UTF_8), storage.download(uploaded.getFilename(), "names"));
    }

    @Test
    void withRoutePrefixTargetsAnotherMount() {
        StorageClient files = storage.withRoutePrefix("/files");
        assertEquals("/files", files.getRoutePrefix());
        assertEquals("/upload", storage.getRoutePrefix());
        assertThrows(NotFoundException.class, files::list);
    }
}
