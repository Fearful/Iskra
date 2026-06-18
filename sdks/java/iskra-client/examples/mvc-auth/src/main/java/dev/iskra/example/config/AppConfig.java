package dev.iskra.example.config;

import dev.iskra.client.IskraClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@Configuration
@EnableWebMvc
@ComponentScan(basePackages = "dev.iskra.example")
public class AppConfig {

    @Bean
    public IskraClient iskraClient() {
        String baseUrl = System.getenv("ISKRA_BASE_URL");
        if (baseUrl == null || baseUrl.isEmpty()) {
            baseUrl = "http://localhost:3000";
        }

        IskraClient.Builder builder = IskraClient.builder(baseUrl);

        String apiKey = System.getenv("ISKRA_API_KEY");
        if (apiKey != null && !apiKey.isEmpty()) {
            builder.apiKey(apiKey);
        }

        return builder.build();
    }
}
